import { ENVIRONMENTS } from '../domain/catalog/environments';
import { INDICATORS } from '../domain/catalog/indicators';
import { evaluateAll, thresholdsFor } from '../domain/engine/evaluate';
import { verifyIntervention, type Intervention } from '../domain/engine/verify';
import { INDICATOR_RULES } from '../domain/evidence/indicatorRules';
import type { AuthorityLevel } from '../domain/evidence/types';
import { DEFAULT_MEDICAL_PLAN, type MedicalPlan } from '../domain/medicalPlan';
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
  /** An intervention was started or its verification changed. */
  interventions: readonly Intervention[];
  medicalPlan: MedicalPlan;
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
  private readonly interventionLog: Intervention[] = [];
  private plan: MedicalPlan = { ...DEFAULT_MEDICAL_PLAN };

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
  get interventions(): readonly Intervention[] {
    return this.interventionLog;
  }
  get medicalPlan(): MedicalPlan {
    return this.plan;
  }
  /** The most recent intervention for an indicator, if any. */
  latestIntervention(id: IndicatorId): Intervention | undefined {
    for (let i = this.interventionLog.length - 1; i >= 0; i--) {
      if (this.interventionLog[i].indicatorId === id) return this.interventionLog[i];
    }
    return undefined;
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

  /**
   * Records that the crew member carried out a treatment step. It stays pending until the
   * Verify step sees the indicator measured back in range (see domain/engine/verify.ts).
   */
  startIntervention(indicatorId: IndicatorId, stepText: string, authorityLevel: AuthorityLevel): Intervention {
    const evaluation = this.current.systems[INDICATORS[indicatorId].systemId].indicators.find((i) => i.def.id === indicatorId);
    const intervention: Intervention = {
      id: this.interventionLog.length + 1,
      indicatorId,
      ruleId: INDICATOR_RULES[indicatorId].ruleId,
      stepText,
      authorityLevel,
      startedAt: this.now,
      valueBefore: evaluation?.latest?.value ?? null,
      statusBefore: evaluation?.status ?? 'unknown',
      outcome: 'pending',
      valueAfter: null,
      checkedAt: null,
    };
    this.interventionLog.push(intervention);
    this.events.emit('interventions', this.interventionLog);
    return intervention;
  }

  setDrugsPreauthorized(drugsPreauthorized: boolean): void {
    if (this.plan.drugsPreauthorized === drugsPreauthorized) return;
    this.plan = { ...this.plan, drugsPreauthorized };
    this.events.emit('medicalPlan', this.plan);
  }

  reset(now: MissionMinutes): void {
    this.readings.clear();
    this.interventionLog.length = 0;
    this.now = now;
    this.events.emit('interventions', this.interventionLog);
    this.recompute();
  }

  private recompute(): void {
    this.current = evaluateAll(this.readings, this.env, this.now);
    this.verifyPending();
    this.events.emit('data', this.current);
  }

  private verifyPending(): void {
    let changed = false;
    for (const intervention of this.interventionLog) {
      if (intervention.outcome !== 'pending') continue;
      const def = INDICATORS[intervention.indicatorId];
      const result = verifyIntervention(intervention, def, this.history(def.id), thresholdsFor(def, this.env), this.now);
      if (result.outcome !== 'pending') {
        Object.assign(intervention, result);
        changed = true;
      }
    }
    if (changed) this.events.emit('interventions', this.interventionLog);
  }
}
