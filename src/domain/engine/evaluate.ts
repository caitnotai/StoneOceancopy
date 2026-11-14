import { indicatorsOf } from '../catalog/indicators';
import { SYSTEMS } from '../catalog/systems';
import { severity, worstOf } from '../status';
import {
  SYSTEM_IDS,
  type EnvironmentDef,
  type Evaluation,
  type HealthStatus,
  type IndicatorDef,
  type IndicatorEvaluation,
  type IndicatorId,
  type MissionMinutes,
  type Range,
  type Reading,
  type SystemEvaluation,
  type SystemId,
  type Thresholds,
} from '../types';
import { monitor, usesIndividualBaseline, type IndividualBaseline } from './monitor';
import { triage } from './triage';

const MINUTES_PER_DAY = 1440;
/** How far ahead a trend is projected to flag "worsening". */
const LOOKAHEAD_DAYS = 2;

const inRange = (v: number, r: Range): boolean => v >= r.min && v <= r.max;

/** The single rule that turns a number into a status. */
export function classify(value: number, th: Thresholds): HealthStatus {
  if (!Number.isFinite(value)) return 'unknown';
  if (inRange(value, th.nominal)) return 'nominal';
  if (inRange(value, th.caution)) return 'caution';
  return 'critical';
}

export const thresholdsFor = (def: IndicatorDef, env: EnvironmentDef): Thresholds =>
  env.thresholdOverrides?.[def.id] ?? def.thresholds;

/**
 * Least-squares slope of recent readings, in units per mission day.
 * Returns null when there is not enough data to say anything.
 */
export function trendPerDay(readings: Reading[], now: MissionMinutes, windowDays = 3): number | null {
  // Whole days only, so the day-night rhythm of heart rate and temperature cancels out.
  const from = now - windowDays * MINUTES_PER_DAY;
  const recent = readings.filter((r) => r.t >= from);
  if (recent.length < 3) return null;
  const n = recent.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const r of recent) {
    const x = (r.t - now) / MINUTES_PER_DAY;
    sx += x;
    sy += r.value;
    sxx += x * x;
    sxy += x * r.value;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  return (n * sxy - sx * sy) / denom;
}

/** What the engine needs to judge an indicator against the person's own baseline. */
export interface MonitoringContext {
  baseline: IndividualBaseline;
  /** Time of the last treatment for this indicator: the detectors restart there. */
  resetAt?: MissionMinutes | null;
}

/** Share of the caution limit at which a drift that has not signaled yet is called "worsening". */
const EARLY_WARNING = 0.6;

export function evaluateIndicator(
  def: IndicatorDef,
  readings: Reading[],
  env: EnvironmentDef,
  now: MissionMinutes,
  monitoring?: MonitoringContext,
): IndicatorEvaluation {
  const latest = readings.length > 0 ? readings[readings.length - 1] : null;
  const due = !latest || now - latest.t > def.cadenceHours * 60;
  const slope = trendPerDay(readings, now);

  // Individual baseline: the status comes from the drift detectors, not from a fixed range.
  if (latest && monitoring && usesIndividualBaseline(def.id)) {
    const drift = monitor(def, readings, monitoring.baseline, now, monitoring.resetAt ?? null);
    const adverse = drift.direction === 'low' ? -drift.ewma : drift.direction === 'high' ? drift.ewma : Math.abs(drift.ewma);
    const worsening = drift.status === 'nominal' && adverse > EARLY_WARNING * drift.ewmaCautionLimit;
    return { def, latest, status: drift.status, due, trendPerDay: slope, worsening, drift };
  }

  const th = thresholdsFor(def, env);
  const status = latest ? classify(latest.value, th) : 'unknown';
  let worsening = false;
  if (latest && slope !== null) {
    const projected = classify(latest.value + slope * LOOKAHEAD_DAYS, th);
    worsening = severity(projected) > severity(status);
  }
  return { def, latest, status, due, trendPerDay: slope, worsening };
}

export function evaluateSystem(
  systemId: SystemId,
  readings: ReadonlyMap<IndicatorId, Reading[]>,
  env: EnvironmentDef,
  now: MissionMinutes,
  monitoring?: ReadonlyMap<IndicatorId, MonitoringContext>,
): SystemEvaluation {
  const indicators = indicatorsOf(systemId).map((def) =>
    evaluateIndicator(def, readings.get(def.id) ?? [], env, now, monitoring?.get(def.id)),
  );
  const status = worstOf(indicators.map((i) => i.status));
  const driver =
    indicators.reduce<IndicatorEvaluation | null>(
      (acc, i) => (!acc || severity(i.status) > severity(acc.status) ? i : acc),
      null,
    ) ?? null;
  return { def: SYSTEMS[systemId], status, indicators, driver };
}

/** Evaluates the whole body. This is the only entry point the rest of the app needs. */
export function evaluateAll(
  readings: ReadonlyMap<IndicatorId, Reading[]>,
  env: EnvironmentDef,
  now: MissionMinutes,
  monitoring?: ReadonlyMap<IndicatorId, MonitoringContext>,
): Evaluation {
  const systems = {} as Record<SystemId, SystemEvaluation>;
  for (const id of SYSTEM_IDS) systems[id] = evaluateSystem(id, readings, env, now, monitoring);
  const due = Object.values(systems)
    .flatMap((s) => s.indicators)
    .filter((i) => i.due && i.def.acquisition === 'self-check');
  return { missionTime: now, systems, triage: triage(systems, env), due };
}
