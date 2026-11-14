import { ENVIRONMENTS } from '../domain/catalog/environments';
import { evaluateAll } from '../domain/engine/evaluate';
import type {
  EnvironmentDef,
  EnvironmentId,
  Evaluation,
  IndicatorId,
  MissionMinutes,
  Reading,
  SystemId,
} from '../domain/types';
import { Emitter } from './Emitter';

const MAX_READINGS_PER_INDICATOR = 1200;

export interface StoreEvents extends Record<string, unknown> {
  /** New readings arrived or mission time advanced; carries the fresh evaluation. */
  data: Evaluation;
  selection: SystemId | null;
  hover: SystemId | null;
  environment: EnvironmentDef;
  visibility: ReadonlySet<SystemId>;
}

/** Anything that produces readings writes them here. */
export interface ReadingSink {
  ingest(readings: Reading[], now: MissionMinutes): void;
}

/**
 * Single source of truth. Data flows one way:
 *   sources -> store.ingest() -> rules engine -> `data` event -> 3D scene and UI panels.
 * Views never talk to each other; they only read the store and call its actions.
 */
export class HealthStore implements ReadingSink {
  readonly events = new Emitter<StoreEvents>();

  private readonly readings = new Map<IndicatorId, Reading[]>();
  private env: EnvironmentDef;
  private now: MissionMinutes = 0;
  private selectedSystem: SystemId | null = null;
  private hoveredSystem: SystemId | null = null;
  private readonly hiddenSystems = new Set<SystemId>();
  private current: Evaluation;

  constructor(environment: EnvironmentId = 'iss') {
    this.env = ENVIRONMENTS[environment];
    this.current = evaluateAll(this.readings, this.env, this.now);
  }

  // ---- queries ----
  get evaluation(): Evaluation {
    return this.current;
  }
  get environment(): EnvironmentDef {
    return this.env;
  }
  get missionTime(): MissionMinutes {
    return this.now;
  }
  get selected(): SystemId | null {
    return this.selectedSystem;
  }
  get hovered(): SystemId | null {
    return this.hoveredSystem;
  }
  get hidden(): ReadonlySet<SystemId> {
    return this.hiddenSystems;
  }
  history(id: IndicatorId): readonly Reading[] {
    return this.readings.get(id) ?? [];
  }

  // ---- actions ----
  ingest(readings: Reading[], now: MissionMinutes): void {
    for (const r of readings) {
      let list = this.readings.get(r.indicatorId);
      if (!list) {
        list = [];
        this.readings.set(r.indicatorId, list);
      }
      list.push(r);
      if (list.length > MAX_READINGS_PER_INDICATOR) list.splice(0, list.length - MAX_READINGS_PER_INDICATOR);
    }
    this.now = Math.max(this.now, now);
    this.recompute();
  }

  setEnvironment(id: EnvironmentId): void {
    if (this.env.id === id) return;
    this.env = ENVIRONMENTS[id];
    this.events.emit('environment', this.env);
    this.recompute();
  }

  select(id: SystemId | null): void {
    if (this.selectedSystem === id) return;
    this.selectedSystem = id;
    this.events.emit('selection', id);
  }

  hover(id: SystemId | null): void {
    if (this.hoveredSystem === id) return;
    this.hoveredSystem = id;
    this.events.emit('hover', id);
  }

  toggleVisibility(id: SystemId): void {
    if (this.hiddenSystems.has(id)) this.hiddenSystems.delete(id);
    else this.hiddenSystems.add(id);
    this.events.emit('visibility', this.hiddenSystems);
  }

  reset(now: MissionMinutes): void {
    this.readings.clear();
    this.now = now;
    this.recompute();
  }

  private recompute(): void {
    this.current = evaluateAll(this.readings, this.env, this.now);
    this.events.emit('data', this.current);
  }
}
