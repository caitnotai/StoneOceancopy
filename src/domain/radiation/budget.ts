import type { Thresholds } from '../types';

/**
 * Mission dose budget in mSv, set by the program. Null means "not reported" (NR): NASA
 * publishes no yellow or red limit for daily or cumulative dose on exploration missions,
 * so by default the dose is tracked and never judged. Set a number to enable the check.
 */
export const MISSION_DOSE_BUDGET_MSV: number | null = null;

/**
 * Dose is acceptable up to the budget and critical beyond it. There is deliberately no
 * intermediate band: any fraction of the budget would be an invented threshold. Early
 * warning comes from the trend (projected dose) and from solar particle event detection.
 */
export function doseThresholds(budgetMSv: number | null): Thresholds {
  const limit = budgetMSv ?? Number.POSITIVE_INFINITY;
  return { nominal: { min: 0, max: limit }, caution: { min: 0, max: limit } };
}

/** Remaining budget in mSv, or null when no budget is set. */
export function doseMargin(cumulativeMSv: number, budgetMSv: number | null): number | null {
  return budgetMSv === null ? null : budgetMSv - cumulativeMSv;
}
