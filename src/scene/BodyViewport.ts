import * as THREE from 'three';
import type { HealthStore } from '../data/HealthStore';
import { SYSTEMS } from '../domain/catalog/systems';
import { STATUS_GLYPH, STATUS_LABEL } from '../domain/status';
import { SYSTEM_IDS, type Evaluation, type SystemId } from '../domain/types';
import { createBackdrop } from './backdrop';
import type { BodyModel, Vitals } from './BodyModel';
import { Picker } from './Picker';
import { RadiationField } from './RadiationField';
import { SceneManager } from './SceneManager';
import { SystemVisuals } from './SystemVisuals';

const MINUTES_PER_DAY = 1440;
/** Systems that span the whole figure keep the full-body view when selected. */
const WHOLE_BODY_HEIGHT = 1.1;

export interface BodyViewportOptions {
  /** URL of the anatomical model (GLB). */
  modelUrl: string;
}

/**
 * The 3D view. It reads the store and reports clicks back to it; it holds no health logic.
 * Store -> (status, selection, hover, visibility) -> SystemVisuals -> materials.
 *
 * The anatomical model loads in the background. If it cannot be loaded (offline, blocked
 * download), the view falls back to a body generated in code, so the app always works.
 */
export class BodyViewport {
  private readonly scene: SceneManager;
  private readonly visuals = new SystemVisuals();
  private readonly picker: Picker;
  private readonly radiation = new RadiationField();
  private readonly tooltip: HTMLDivElement;
  private readonly notice: HTMLDivElement;
  private readonly bounds = new Map<SystemId, THREE.Box3>();
  private readonly vitals: Vitals = { heartRateBpm: 62, breathsPerMinute: 14 };
  private readonly unsubscribe: (() => void)[] = [];
  private model: BodyModel | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly store: HealthStore,
    options: BodyViewportOptions,
  ) {
    this.scene = new SceneManager(container);
    const backdrop = createBackdrop();
    this.scene.scene.add(backdrop.object, this.radiation.object);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'viewport-tooltip';
    this.tooltip.hidden = true;
    this.notice = document.createElement('div');
    this.notice.className = 'viewport-notice';
    this.notice.setAttribute('role', 'status');
    container.append(this.tooltip, this.notice);

    this.picker = new Picker(
      this.scene.renderer.domElement,
      this.scene.camera,
      () => this.model,
      (id) => store.hidden.has(id),
      {
        onHover: (stack, x, y) => this.showHover(stack, x, y),
        onPick: (stack) => this.pick(stack),
      },
    );

    this.unsubscribe.push(
      store.events.on('data', (evaluation) => this.applyEvaluation(evaluation)),
      store.events.on('selection', (id) => this.applySelection(id)),
      store.events.on('hover', (id) => this.visuals.setHovered(id)),
      store.events.on('visibility', (hidden) => this.visuals.setHidden(hidden)),
      this.scene.onFrame((dt, elapsed) => {
        this.picker.update();
        this.visuals.update(dt, elapsed);
        this.model?.update(elapsed, this.vitals);
        this.radiation.setColor(this.visuals.colorOf('radiation'));
        this.radiation.update(dt);
        backdrop.update(elapsed);
      }),
    );

    this.applyEvaluation(store.evaluation);
    this.visuals.setSelected(store.selected);
    this.scene.start();
    void this.loadModel(options.modelUrl);
  }

  dispose(): void {
    this.unsubscribe.forEach((off) => off());
    this.picker.dispose();
    this.model?.dispose();
    this.scene.dispose();
    this.tooltip.remove();
    this.notice.remove();
  }

  private async loadModel(url: string): Promise<void> {
    this.notice.textContent = 'Loading anatomical model…';
    try {
      // Loaded on demand: the loader and the model are the heaviest part of the app.
      const { GltfBody } = await import('./gltf/GltfBody');
      this.setModel(
        await GltfBody.load(url, (fraction) => {
          this.notice.textContent = `Loading anatomical model… ${Math.round(fraction * 100)}%`;
        }),
      );
      this.notice.hidden = true;
    } catch (error) {
      console.warn('Anatomical model unavailable, using the simplified body.', error);
      const { ProceduralBody } = await import('./procedural/ProceduralBody');
      this.setModel(new ProceduralBody());
      this.notice.textContent = 'Detailed anatomy could not be loaded. Showing a simplified body.';
      window.setTimeout(() => (this.notice.hidden = true), 6000);
    }
  }

  private setModel(model: BodyModel): void {
    if (this.model) {
      this.scene.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.model = model;
    this.scene.scene.add(model.root);
    this.visuals.setModel(model);
    this.bounds.clear();
    for (const [id, layer] of model.layers) this.bounds.set(id, new THREE.Box3().setFromObject(layer.group));
    this.applySelection(this.store.selected);
  }

  private applyEvaluation(evaluation: Evaluation): void {
    for (const id of SYSTEM_IDS) this.visuals.setStatus(id, evaluation.systems[id].status);

    const heartRate = evaluation.systems.cardiovascular.indicators.find((i) => i.def.id === 'heartRate')?.latest?.value;
    if (heartRate) this.vitals.heartRateBpm = heartRate;

    // Dose rate from the last two dosimeter readings; falls back to the environment's typical rate.
    const dose = this.store.history('radiationDose');
    let rate = this.store.environment.radiationMSvPerDay;
    if (dose.length >= 2) {
      const a = dose[dose.length - 2];
      const b = dose[dose.length - 1];
      if (b.t > a.t) rate = ((b.value - a.value) / (b.t - a.t)) * MINUTES_PER_DAY;
    }
    this.radiation.setDoseRate(rate);
  }

  private applySelection(id: SystemId | null): void {
    this.visuals.setSelected(id);
    const box = id ? this.bounds.get(id) : null;
    const wholeBody = !box || box.isEmpty() || box.getSize(new THREE.Vector3()).y > WHOLE_BODY_HEIGHT;
    this.scene.focusOn(wholeBody ? null : box);
  }

  /** Clicking the same spot again steps to the next system underneath ("go deeper"). */
  private pick(stack: SystemId[]): void {
    if (stack.length === 0) {
      this.store.select(null);
      return;
    }
    const current = this.store.selected ? stack.indexOf(this.store.selected) : -1;
    this.store.select(stack[(current + 1) % stack.length]);
  }

  private showHover(stack: SystemId[], clientX: number, clientY: number): void {
    const id = stack[0] ?? null;
    this.store.hover(id);
    this.scene.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    if (!id) {
      this.tooltip.hidden = true;
      return;
    }
    const status = this.store.evaluation.systems[id].status;
    const rect = this.container.getBoundingClientRect();
    this.tooltip.hidden = false;
    this.tooltip.dataset.status = status;
    this.tooltip.replaceChildren(
      Object.assign(document.createElement('span'), { className: 'status-glyph', textContent: STATUS_GLYPH[status] }),
      Object.assign(document.createElement('strong'), { textContent: SYSTEMS[id].name }),
      Object.assign(document.createElement('span'), { className: 'tooltip-status', textContent: STATUS_LABEL[status] }),
    );
    if (stack.length > 1) {
      this.tooltip.appendChild(
        Object.assign(document.createElement('small'), { textContent: `Click again for ${SYSTEMS[stack[1]].name.toLowerCase()}` }),
      );
    }
    const x = Math.min(clientX - rect.left + 16, rect.width - 220);
    this.tooltip.style.transform = `translate(${Math.max(8, x)}px, ${clientY - rect.top + 16}px)`;
  }
}
