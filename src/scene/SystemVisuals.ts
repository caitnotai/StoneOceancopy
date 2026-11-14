import * as THREE from 'three';
import { STATUS_COLOR } from '../domain/status';
import { SYSTEM_IDS, type HealthStatus, type SystemId } from '../domain/types';
import type { BodyModel } from './BodyModel';

const COLORS: Record<HealthStatus, THREE.Color> = {
  unknown: new THREE.Color(STATUS_COLOR.unknown),
  nominal: new THREE.Color(STATUS_COLOR.nominal),
  caution: new THREE.Color(STATUS_COLOR.caution),
  critical: new THREE.Color(STATUS_COLOR.critical),
};

const DIMMED_OPACITY = 0.07;
const DIMMED_HOVER_OPACITY = 0.3;

interface LayerState {
  status: HealthStatus;
  color: THREE.Color;
  opacity: number;
  emphasis: number;
  focus: number;
}

/**
 * Turns application state (status, selection, hover, visibility) into what each body system
 * looks like. This is the only place where "status -> color" happens in 3D. It keeps its
 * state when the body model is swapped, so a model that loads late shows the right colors.
 */
export class SystemVisuals {
  private readonly state = new Map<SystemId, LayerState>();
  private model: BodyModel | null = null;
  private selected: SystemId | null = null;
  private hovered: SystemId | null = null;
  private hidden: ReadonlySet<SystemId> = new Set();

  constructor() {
    for (const id of SYSTEM_IDS) {
      this.state.set(id, { status: 'unknown', color: COLORS.unknown.clone(), opacity: 1, emphasis: 0, focus: 0 });
    }
  }

  setModel(model: BodyModel | null): void {
    this.model = model;
  }

  setStatus(id: SystemId, status: HealthStatus): void {
    const s = this.state.get(id);
    if (s) s.status = status;
  }

  setSelected(id: SystemId | null): void {
    this.selected = id;
  }

  setHovered(id: SystemId | null): void {
    this.hovered = id;
  }

  setHidden(hidden: ReadonlySet<SystemId>): void {
    this.hidden = hidden;
  }

  colorOf(id: SystemId): THREE.Color {
    return this.state.get(id)?.color ?? COLORS.unknown;
  }

  update(dt: number, elapsed: number): void {
    const ease = 1 - Math.exp(-dt * 7);
    for (const id of SYSTEM_IDS) {
      const s = this.state.get(id)!;
      const isSelected = this.selected === id;
      const isHovered = this.hovered === id;
      const dimmed = this.selected !== null && !isSelected;

      const targetOpacity = dimmed ? (isHovered ? DIMMED_HOVER_OPACITY : DIMMED_OPACITY) : 1;
      // Alarm pulse: a second, non-color signal that something needs attention.
      const pulse =
        s.status === 'critical'
          ? 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 6.5))
          : s.status === 'caution'
            ? 0.25 * (0.5 + 0.5 * Math.sin(elapsed * 2.6))
            : 0;
      // Systems that need attention glow more than healthy ones, so they stand out at a glance.
      const alert = s.status === 'critical' ? 0.55 : s.status === 'caution' ? 0.35 : 0;
      const targetEmphasis = (isSelected ? 0.45 : 0) + (isHovered ? 0.4 : 0) + alert + pulse;

      s.color.lerp(COLORS[s.status], ease);
      s.opacity += (targetOpacity - s.opacity) * ease;
      s.emphasis += (targetEmphasis - s.emphasis) * Math.min(1, ease * 2);
      s.focus += ((isSelected ? 1 : 0) - s.focus) * ease;

      const layer = this.model?.layers.get(id);
      if (!layer) continue;
      layer.group.visible = !this.hidden.has(id);
      if (!layer.group.visible) continue;
      for (const material of layer.materials) material.apply(s.color, s.emphasis, s.opacity, elapsed, s.focus);
    }
  }
}
