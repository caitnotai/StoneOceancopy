import { normalQuantile } from './normal.ts';

/**
 * Cabin CO2: the hard rule and a headache-risk model.
 *
 * Hard rule (NASA-STD-3001 Vol. 2 [V2 6004]): the one-hour average ppCO2 shall be 3 mmHg
 * or less. That is the only limit; it is checked in `oneHourMeanExceeds`.
 *
 * Risk model: a logistic curve for the probability of reporting a headache as a function of
 * the 7-day average ppCO2. It is a prior taken from published ISS data, not a fit of ours:
 * the odds roughly double for each extra mmHg, and the risk is about 1% at 2.5 mmHg (which
 * gives about 1.4% at 3 mmHg, as reported). The spread of the odds ratio is NOT reported in
 * our source, so `logOddsRatioSd` is an assumption and is labeled as such wherever shown.
 */
export const CO2_ONE_HOUR_LIMIT_MMHG = 3;

export interface Co2HeadachePrior {
  oddsRatioPerMmHg: number;
  /** Assumed standard deviation of the log odds ratio (not reported by the source). */
  logOddsRatioSd: number;
  anchorMmHg: number;
  anchorRisk: number;
}

export const CO2_HEADACHE_PRIOR: Co2HeadachePrior = {
  oddsRatioPerMmHg: 2,
  logOddsRatioSd: 0.25,
  anchorMmHg: 2.5,
  anchorRisk: 0.01,
};

const logit = (p: number): number => Math.log(p / (1 - p));
const expit = (x: number): number => 1 / (1 + Math.exp(-x));

/** Estimated probability of a headache report at a given 7-day average ppCO2. */
export function headacheRisk(sevenDayMeanMmHg: number, prior: Co2HeadachePrior = CO2_HEADACHE_PRIOR): number {
  return expit(logit(prior.anchorRisk) + Math.log(prior.oddsRatioPerMmHg) * (sevenDayMeanMmHg - prior.anchorMmHg));
}

/** Interval for that probability from the assumed uncertainty of the odds ratio. */
export function headacheRiskInterval(sevenDayMeanMmHg: number, level = 0.95, prior: Co2HeadachePrior = CO2_HEADACHE_PRIOR): [number, number] {
  const z = normalQuantile(0.5 + level / 2);
  const delta = sevenDayMeanMmHg - prior.anchorMmHg;
  const at = (logOr: number): number => expit(logit(prior.anchorRisk) + logOr * delta);
  const a = at(Math.log(prior.oddsRatioPerMmHg) - z * prior.logOddsRatioSd);
  const b = at(Math.log(prior.oddsRatioPerMmHg) + z * prior.logOddsRatioSd);
  return [Math.min(a, b), Math.max(a, b)];
}

/** The hard rule: true when a one-hour average is above the 3 mmHg standard. */
export const oneHourMeanExceeds = (oneHourMeanMmHg: number): boolean => oneHourMeanMmHg > CO2_ONE_HOUR_LIMIT_MMHG;
