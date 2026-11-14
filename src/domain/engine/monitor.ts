import calibration from '../../../data/validation/drift-calibration.json';
import { fitBaseline, standardize, type Baseline } from '../stats/baseline';
import { cusum, ewma } from '../stats/drift';
import type { DriftSummary, DriftTrigger, HealthStatus, IndicatorDef, IndicatorId, MissionMinutes, Range, Reading } from '../types';

const LEVELS = calibration.operational.levels;

/**
 * Monitoring against the individual baseline, for the indicators where NASA publishes no
 * limit. The person is compared with themselves:
 *
 *   1. readings are reduced to one value per crew day: the day's mean for a sensor, the
 *      day's measurement for something measured once a day;
 *   2. the first 14 complete days are the baseline, fitted once and then frozen;
 *   3. every later day is standardized against it and fed to EWMA and CUSUM, which catch a
 *      change that is small but sustained;
 *   4. the value now (latest daily measurement, or the mean of the last 24 hours for a
 *      sensor) is compared with the baseline directly, which catches a sudden large change;
 *   5. the status is caution or critical when any of the three is beyond its limit now.
 *
 * The limits are not chosen here. They come from `data/validation/drift-calibration.json`,
 * calibrated for exactly this use (baseline estimated from 14 values): about 3.8% chance of
 * a false caution, and 0.4% of a false critical, per indicator per 30 days. See METHODS.md.
 */
export const MONITORING = {
  baselineDays: calibration.operational.baselineReadings,
  dayMinutes: 1440,
  /** The crew day runs from 08:00 to 08:00. */
  dayStartMinute: 480,
  /** Readings a sensor needs in a day, or in the last 24 hours, for its mean to be used. */
  minSensorReadings: 4,
  /** Share of the 24 hours those readings must span, so the day-night rhythm averages out. */
  minDayCoverage: 0.75,
  /** Half-width of the person's usual range, in predictive SDs: 95% of their days. */
  usualRangeSd: 1.96,
  lambda: calibration.ewma.lambda,
  k: calibration.cusum.k,
  caution: { ewmaLimit: LEVELS.caution.ewmaLimit, cusumH: LEVELS.caution.cusumH, singleValueLimit: LEVELS.caution.singleValueLimit },
  critical: { ewmaLimit: LEVELS.critical.ewmaLimit, cusumH: LEVELS.critical.cusumH, singleValueLimit: LEVELS.critical.singleValueLimit },
} as const;

/** Smallest step in mission minutes: "strictly after" a given time. */
export const AFTER = 1e-3;

export type AdverseDirection = 'low' | 'high' | 'both';

/**
 * Which direction of change is a problem. A crew member sleeping or exercising more than
 * their baseline is not an alert. Indicators absent from this table keep their own
 * thresholds: the two NASA limits, the NOAA scale, the dose budget, and the vision score,
 * which is taken too rarely to build a 14-value baseline.
 */
export const ADVERSE_DIRECTION: Partial<Record<IndicatorId, AdverseDirection>> = {
  heartRate: 'both',
  systolicBP: 'both',
  resistiveExercise: 'low',
  aerobicExercise: 'low',
  spo2: 'low',
  sleepHours: 'low',
  mood: 'low',
  dizziness: 'high',
  bodyTemp: 'high',
  glucose: 'both',
  calorieIntake: 'low',
};

export const usesIndividualBaseline = (id: IndicatorId): boolean => id in ADVERSE_DIRECTION;

export interface DailyValue {
  /** End of the crew day the value belongs to. */
  end: MissionMinutes;
  /** Time of the last reading that went into the value. */
  at: MissionMinutes;
  value: number;
  readings: number;
  /** False for the day that is still running. */
  complete: boolean;
}

const isSensor = (def: IndicatorDef): boolean => def.cadenceHours <= 2;

/**
 * One value per crew day. For a sensor it is the mean of that day's readings; for a measure
 * taken once a day it is the latest reading of the day, so a repeated measurement replaces
 * the earlier one. A reading taken exactly at the day boundary opens the new day.
 * Only readings from `from` onwards are used.
 */
export function dailyValues(def: IndicatorDef, readings: readonly Reading[], now: MissionMinutes, from = Number.NEGATIVE_INFINITY): DailyValue[] {
  const { dayMinutes, dayStartMinute, minSensorReadings } = MONITORING;
  const sensor = isSensor(def);
  const days = new Map<number, { sum: number; n: number; last: number; at: MissionMinutes }>();
  for (const r of readings) {
    if (r.t < from) continue;
    const index = Math.floor((r.t - dayStartMinute) / dayMinutes);
    const day = days.get(index) ?? { sum: 0, n: 0, last: r.value, at: r.t };
    day.sum += r.value;
    day.n += 1;
    day.last = r.value;
    day.at = r.t;
    days.set(index, day);
  }
  const needed = sensor ? minSensorReadings : 1;
  return [...days]
    .sort((a, b) => a[0] - b[0])
    .filter(([, day]) => day.n >= needed)
    .map(([index, day]) => {
      const end = dayStartMinute + (index + 1) * dayMinutes;
      return { end, at: day.at, value: sensor ? day.sum / day.n : day.last, readings: day.n, complete: end <= now };
    });
}

/**
 * Where the person is right now, in a form comparable with a baseline day. For a measure
 * taken once a day it is the latest reading. For a sensor it is the mean of the last 24
 * hours, never the part of the crew day lived so far: heart rate and temperature follow a
 * day-night rhythm, and half a day would look like a change that is not there.
 * Only readings taken after `after` count, and a sensor needs a full 24 hours after it.
 */
export function currentValue(
  def: IndicatorDef,
  readings: readonly Reading[],
  now: MissionMinutes,
  after = Number.NEGATIVE_INFINITY,
): { t: MissionMinutes; value: number } | null {
  if (!isSensor(def)) {
    const last = readings[readings.length - 1];
    return last && last.t > after ? { t: last.t, value: last.value } : null;
  }
  const { dayMinutes, minSensorReadings, minDayCoverage } = MONITORING;
  const from = now - dayMinutes;
  if (from < after) return null;
  let sum = 0;
  let n = 0;
  let first = now;
  for (let i = readings.length - 1; i >= 0 && readings[i].t > from; i--) {
    sum += readings[i].value;
    n += 1;
    first = readings[i].t;
  }
  if (n < minSensorReadings) return null;
  const last = readings[readings.length - 1].t;
  if (last - first < minDayCoverage * dayMinutes) return null;
  return { t: last, value: sum / n };
}

/** A person's own baseline for one indicator, frozen once it has been fitted. */
export interface IndividualBaseline {
  baseline: Baseline;
  /** End of the last baseline day: monitoring starts after it. */
  until: MissionMinutes;
  days: number;
}

/** Fits the baseline from the first complete days, or returns null while there are too few. */
export function fitIndividualBaseline(def: IndicatorDef, readings: readonly Reading[], now: MissionMinutes): IndividualBaseline | null {
  const complete = dailyValues(def, readings, now).filter((d) => d.complete);
  if (complete.length < MONITORING.baselineDays) return null;
  const period = complete.slice(0, MONITORING.baselineDays);
  const baseline = fitBaseline(period.map((d) => d.value));
  // A perfectly constant baseline would make every later change infinitely unlikely.
  const resolution = 0.5 / 10 ** def.decimals;
  return { baseline: { ...baseline, sd: Math.max(baseline.sd, resolution) }, until: period[period.length - 1].end, days: period.length };
}

/** The band `width` predictive SDs around a baseline, bounded on the adverse side only. */
function band(direction: AdverseDirection, baseline: Baseline, width: number): Range {
  return {
    min: direction === 'high' ? Number.NEGATIVE_INFINITY : baseline.mean - width * baseline.sd,
    max: direction === 'low' ? Number.POSITIVE_INFINITY : baseline.mean + width * baseline.sd,
  };
}

/**
 * Judges an indicator against the person's baseline. After a treatment (`resetAt`) the
 * detectors restart, so the status reflects how the person is responding and not the
 * excursion that prompted the action. Until a first value exists after the restart, the
 * earlier status stands.
 */
export function monitor(
  def: IndicatorDef,
  readings: readonly Reading[],
  individual: IndividualBaseline,
  now: MissionMinutes,
  resetAt: MissionMinutes | null = null,
): DriftSummary {
  const direction = ADVERSE_DIRECTION[def.id] ?? 'both';
  const { baseline, until } = individual;
  const { dayMinutes, dayStartMinute } = MONITORING;
  const sensor = isSensor(def);
  const restarted = resetAt !== null && resetAt > until;

  // Everything strictly after `start` is monitored. A sensor contributes whole crew days only.
  const since = (start: MissionMinutes) => {
    const from = sensor ? dayStartMinute + Math.ceil((start - dayStartMinute) / dayMinutes) * dayMinutes : start + AFTER;
    return {
      days: dailyValues(def, readings, now, from).filter((d) => d.complete || !sensor),
      current: currentValue(def, readings, now, start),
    };
  };
  let { days, current } = since(restarted ? resetAt : until - AFTER);
  const awaitingFirstValue = restarted && days.length === 0 && current === null;
  if (awaitingFirstValue) ({ days, current } = since(until - AFTER));

  const z = days.map((d) => standardize(d.value, baseline));
  const e = ewma(z, { lambda: MONITORING.lambda, limit: MONITORING.caution.ewmaLimit });
  const c = cusum(z, { k: MONITORING.k, h: MONITORING.caution.cusumH });
  const ewmaCriticalLimit = (e.lastLimit / MONITORING.caution.ewmaLimit) * MONITORING.critical.ewmaLimit;
  const high = z.length > 0 ? c.high[c.high.length - 1] : 0;
  const low = z.length > 0 ? c.low[c.low.length - 1] : 0;
  const cusumNow = direction === 'high' ? high : direction === 'low' ? low : Math.max(high, low);
  const zNow = current ? standardize(current.value, baseline) : null;

  /** How far a standardized value is on the side that counts as a problem. */
  const adverse = (value: number): number => (direction === 'low' ? -value : direction === 'high' ? value : Math.abs(value));
  const beyond = (single: number, ewmaLimit: number, h: number): DriftTrigger | null => {
    if (zNow !== null && adverse(zNow) > single) return 'single_value';
    if (z.length > 0 && adverse(e.last) > ewmaLimit) return 'ewma';
    if (z.length > 0 && cusumNow > h) return 'cusum';
    return null;
  };
  const criticalBy = beyond(MONITORING.critical.singleValueLimit, ewmaCriticalLimit, MONITORING.critical.cusumH);
  const cautionBy = beyond(MONITORING.caution.singleValueLimit, e.lastLimit, MONITORING.caution.cusumH);
  const status: HealthStatus = criticalBy ? 'critical' : cautionBy ? 'caution' : 'nominal';

  return {
    status,
    trigger: criticalBy ?? cautionBy,
    direction,
    baselineMean: baseline.mean,
    baselineSd: baseline.sd,
    baselineDays: individual.days,
    baselineUntil: until,
    usualRange: band(direction, baseline, MONITORING.usualRangeSd),
    bands: {
      nominal: band(direction, baseline, MONITORING.caution.singleValueLimit),
      caution: band(direction, baseline, MONITORING.critical.singleValueLimit),
    },
    current: current && zNow !== null ? { t: current.t, value: current.value, z: zNow } : null,
    singleValueCautionLimit: MONITORING.caution.singleValueLimit,
    singleValueCriticalLimit: MONITORING.critical.singleValueLimit,
    series: days.map((d, i) => ({ t: d.end, value: d.value, z: z[i] })),
    ewma: e.last,
    ewmaCautionLimit: e.lastLimit,
    ewmaCriticalLimit,
    cusum: cusumNow,
    cusumCautionLimit: MONITORING.caution.cusumH,
    cusumCriticalLimit: MONITORING.critical.cusumH,
    awaitingFirstValue,
  };
}

/** True when a value is inside the person's usual range (95% of their days) on the adverse side. */
export function withinUsualRange(def: IndicatorDef, value: number, individual: IndividualBaseline): boolean {
  const range = band(ADVERSE_DIRECTION[def.id] ?? 'both', individual.baseline, MONITORING.usualRangeSd);
  return value >= range.min && value <= range.max;
}
