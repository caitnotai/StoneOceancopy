import type { AuthorityLevel } from '../evidence/types';
import type { HealthStatus, IndicatorDef, IndicatorId, MissionMinutes, Reading, Thresholds } from '../types';
import { classify } from './evaluate';
import { currentValue, usesIndividualBaseline, withinUsualRange, type IndividualBaseline } from './monitor';

export type VerificationOutcome = 'pending' | 'verified' | 'not_verified';

/** Something the crew member did in response to an alert, waiting for a measured response. */
export interface Intervention {
  id: number;
  indicatorId: IndicatorId;
  ruleId: string;
  stepText: string;
  authorityLevel: AuthorityLevel;
  startedAt: MissionMinutes;
  valueBefore: number | null;
  statusBefore: HealthStatus;
  outcome: VerificationOutcome;
  valueAfter: number | null;
  checkedAt: MissionMinutes | null;
}

/** Readings needed back in range before a response counts: one would too often be noise. */
const confirmations = (def: IndicatorDef): number => (def.cadenceHours <= 2 ? 3 : 1);

const THREE_DAYS_MIN = 3 * 1440;

/**
 * How long the response is given before the intervention counts as not verified.
 * Against a fixed limit: three measurement cycles, and never less than six hours.
 * Against the individual baseline: three days, because the comparison is between days
 * (a sensor needs a full 24 hours after the treatment before it has a value to compare).
 */
export const verificationWindowMin = (def: IndicatorDef, againstBaseline = false): number =>
  againstBaseline ? THREE_DAYS_MIN : Math.max(def.cadenceHours * 60 * 3, 360);

/**
 * The Verify step. An intervention is never closed because it was carried out: it is
 * verified only when the indicator it targets is measured back where it should be, and it
 * is marked not verified when the window passes without that response.
 *
 * "Where it should be" is the nominal range for indicators with a limit, and the person's
 * own usual range (95% predictive interval of a daily value) for indicators judged against
 * the individual baseline.
 */
export function verifyIntervention(
  intervention: Intervention,
  def: IndicatorDef,
  readings: readonly Reading[],
  thresholds: Thresholds,
  now: MissionMinutes,
  individual?: IndividualBaseline,
): Pick<Intervention, 'outcome' | 'valueAfter' | 'checkedAt'> {
  if (intervention.outcome !== 'pending') {
    return { outcome: intervention.outcome, valueAfter: intervention.valueAfter, checkedAt: intervention.checkedAt };
  }

  if (individual && usesIndividualBaseline(def.id)) {
    // The value now, measured entirely after the treatment.
    const latest = currentValue(def, readings, now, intervention.startedAt);
    const rounded = latest ? Math.round(latest.value * 10 ** (def.decimals + 1)) / 10 ** (def.decimals + 1) : null;
    if (latest && withinUsualRange(def, latest.value, individual)) {
      return { outcome: 'verified', valueAfter: rounded, checkedAt: latest.t };
    }
    if (now - intervention.startedAt > verificationWindowMin(def, true)) return { outcome: 'not_verified', valueAfter: rounded, checkedAt: now };
    return { outcome: 'pending', valueAfter: null, checkedAt: null };
  }

  const after = readings.filter((r) => r.t > intervention.startedAt);
  const needed = confirmations(def);
  const latest = after.slice(-needed);
  if (latest.length === needed && latest.every((r) => classify(r.value, thresholds) === 'nominal')) {
    const last = latest[latest.length - 1];
    return { outcome: 'verified', valueAfter: last.value, checkedAt: last.t };
  }
  if (now - intervention.startedAt > verificationWindowMin(def)) {
    const last = after[after.length - 1];
    return { outcome: 'not_verified', valueAfter: last?.value ?? null, checkedAt: now };
  }
  return { outcome: 'pending', valueAfter: null, checkedAt: null };
}
