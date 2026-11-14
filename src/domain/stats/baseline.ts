import { normalQuantile, summarize } from './normal.ts';

/**
 * Individual baseline with empirical-Bayes shrinkage (normal-normal model).
 *
 *   y_ij ~ Normal(theta_i, sigma^2)     reading j of crew member i
 *   theta_i ~ Normal(mu, tau^2)         crew members differ from one another
 *
 * mu, tau and sigma are estimated from a reference population (`fitPopulation`); a crew
 * member's baseline is then the posterior of theta_i given their own readings
 * (`fitBaseline`). With few readings the estimate leans on the population; with many it
 * converges to the person's own mean. This is the "deviation from the individual baseline"
 * that replaces fixed thresholds wherever NASA publishes no limit.
 */
export interface PopulationPrior {
  /** mu: mean of the subject means. */
  mean: number;
  /** tau: standard deviation between subjects. */
  betweenSd: number;
  /** sigma: standard deviation within a subject. */
  withinSd: number;
  subjects: number;
  source: string;
}

export interface Baseline {
  /** Posterior mean of the person's true level. */
  mean: number;
  /** Predictive standard deviation of one new reading (level uncertainty plus noise). */
  sd: number;
  /** Posterior standard deviation of the level itself. */
  meanSd: number;
  /** Number of the person's own readings used. */
  n: number;
  /** 0 = own data only, 1 = population only. */
  shrinkage: number;
  method: 'empirical-bayes' | 'individual';
}

/** Weight of the population's within-subject variance, in pseudo degrees of freedom. */
const PRIOR_VARIANCE_DF = 4;

/**
 * Method-of-moments estimates for the one-way random-effects model.
 * `groups` holds the repeated readings of each subject; subjects with fewer than two
 * readings are ignored.
 */
export function fitPopulation(groups: readonly (readonly number[])[], source: string): PopulationPrior {
  const usable = groups.map(summarize).filter((g) => g.n >= 2);
  if (usable.length < 2) throw new Error('fitPopulation needs at least two subjects with two readings each');
  const k = usable.length;
  const mean = usable.reduce((a, g) => a + g.mean, 0) / k;
  const withinVariance = usable.reduce((a, g) => a + (g.n - 1) * g.variance, 0) / usable.reduce((a, g) => a + (g.n - 1), 0);
  const varianceOfMeans = usable.reduce((a, g) => a + (g.mean - mean) ** 2, 0) / (k - 1);
  // The spread of the subject means overstates tau^2 by the noise in each mean.
  const noiseInMeans = withinVariance * (usable.reduce((a, g) => a + 1 / g.n, 0) / k);
  const betweenVariance = Math.max(0, varianceOfMeans - noiseInMeans);
  return { mean, betweenSd: Math.sqrt(betweenVariance), withinSd: Math.sqrt(withinVariance), subjects: k, source };
}

/**
 * Baseline of one person from their own readings, shrunk toward the population when a
 * prior is given. Without a prior it is the plain individual baseline (needs two readings).
 */
export function fitBaseline(own: readonly number[], prior?: PopulationPrior): Baseline {
  const { n, mean: ownMean, variance: ownVariance } = summarize(own);
  if (!prior) {
    if (n < 2) throw new Error('An individual baseline without a population prior needs at least two readings');
    const meanVariance = ownVariance / n;
    return { mean: ownMean, sd: Math.sqrt(ownVariance + meanVariance), meanSd: Math.sqrt(meanVariance), n, shrinkage: 0, method: 'individual' };
  }
  const tau2 = prior.betweenSd ** 2;
  if (n === 0) {
    return { mean: prior.mean, sd: Math.sqrt(prior.withinSd ** 2 + tau2), meanSd: prior.betweenSd, n: 0, shrinkage: 1, method: 'empirical-bayes' };
  }
  // Within-subject variance: the person's own, stabilized by the population's.
  const sigma2 = ((n - 1) * ownVariance + PRIOR_VARIANCE_DF * prior.withinSd ** 2) / (n - 1 + PRIOR_VARIANCE_DF);
  const noise = sigma2 / n;
  const shrinkage = tau2 + noise === 0 ? 1 : noise / (noise + tau2);
  const mean = shrinkage * prior.mean + (1 - shrinkage) * ownMean;
  const meanVariance = (1 - shrinkage) * noise;
  return { mean, sd: Math.sqrt(sigma2 + meanVariance), meanSd: Math.sqrt(meanVariance), n, shrinkage, method: 'empirical-bayes' };
}

/** Interval expected to contain one new reading with the given probability. */
export function predictiveInterval(baseline: Baseline, level = 0.95): [number, number] {
  const z = normalQuantile(0.5 + level / 2);
  return [baseline.mean - z * baseline.sd, baseline.mean + z * baseline.sd];
}

/** A reading in predictive standard deviations from the baseline. */
export const standardize = (value: number, baseline: Baseline): number => (value - baseline.mean) / baseline.sd;
