import type { AuthorityLevel } from '../evidence/types';
import type { HealthStatus, IndicatorDef, IndicatorId, MissionMinutes, Reading, Thresholds } from '../types';
import { classify } from './evaluate';

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

/**
 * How long the response is given before the intervention counts as not verified:
 * three measurement cycles, and never less than six hours.
 */
export const verificationWindowMin = (def: IndicatorDef): number => Math.max(def.cadenceHours * 60 * 3, 360);

/**
 * The Verify step. An intervention is never closed because it was carried out: it is
 * verified only when the indicator it targets is measured back in its nominal range, and
 * it is marked not verified when the window passes without that response.
 */
export function verifyIntervention(
  intervention: Intervention,
  def: IndicatorDef,
  readings: readonly Reading[],
  thresholds: Thresholds,
  now: MissionMinutes,
): Pick<Intervention, 'outcome' | 'valueAfter' | 'checkedAt'> {
  if (intervention.outcome !== 'pending') {
    return { outcome: intervention.outcome, valueAfter: intervention.valueAfter, checkedAt: intervention.checkedAt };
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
