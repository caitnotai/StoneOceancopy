import * as THREE from 'three';
import type { SystemId } from '../domain/types';
import type { BodyModel } from './BodyModel';

export interface PickerHandlers {
  /** `stack` lists every system under the pointer, most relevant first. */
  onHover(stack: SystemId[], clientX: number, clientY: number): void;
  onPick(stack: SystemId[]): void;
}

const CLICK_TOLERANCE_PX = 5;

/**
 * Mouse/touch picking of body systems by raycasting. Translucent layers (muscle, skin)
 * wrap everything, so they only win when nothing solid is under the pointer.
 */
export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pending: { x: number; y: number } | null = null;
  private down: { x: number; y: number } | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly model: () => BodyModel | null,
    private readonly isHidden: (id: SystemId) => boolean,
    private readonly handlers: PickerHandlers,
  ) {
    // One hit per mesh is enough to know which systems lie under the pointer.
    this.raycaster.firstHitOnly = true;
    const signal = this.abort.signal;
    dom.addEventListener('pointermove', (e) => (this.pending = { x: e.clientX, y: e.clientY }), { signal });
    dom.addEventListener(
      'pointerleave',
      () => {
        this.pending = null;
        handlers.onHover([], 0, 0);
      },
      { signal },
    );
    dom.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }), { signal });
    dom.addEventListener(
      'pointerup',
      (e) => {
        const start = this.down;
        this.down = null;
        // A drag rotates the camera; only a still click selects.
        if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_TOLERANCE_PX) return;
        handlers.onPick(this.stackAt(e.clientX, e.clientY));
      },
      { signal },
    );
  }

  /** Call once per frame: hover is resolved at most once per frame, however fast the mouse moves. */
  update(): void {
    if (!this.pending || this.down) return;
    const { x, y } = this.pending;
    this.pending = null;
    this.handlers.onHover(this.stackAt(x, y), x, y);
  }

  dispose(): void {
    this.abort.abort();
  }

  private stackAt(clientX: number, clientY: number): SystemId[] {
    const model = this.model();
    if (!model) return [];
    const rect = this.dom.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster
      .intersectObjects(model.pickables, false)
      .filter((hit) => !this.isHidden(hit.object.userData.systemId as SystemId))
      // Stable sort: solid tissue before translucent layers, nearest first within each.
      .sort((a, b) => (a.object.userData.pickRank as number) - (b.object.userData.pickRank as number));
    const stack: SystemId[] = [];
    for (const hit of hits) {
      const id = hit.object.userData.systemId as SystemId;
      if (!stack.includes(id)) stack.push(id);
    }
    return stack;
  }
}
