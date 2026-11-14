/**
 * Drift detection on standardized readings (z-scores against the individual baseline).
 *
 * A single reading outside its range is often noise; a small shift that persists is not.
 * EWMA and CUSUM both accumulate evidence over time, so they catch sustained drifts of
 * about one standard deviation that a per-reading threshold would miss. Their limits are
 * not chosen by hand: `tools/validate/calibrate-drift.mjs` finds the limit that gives a
 * target false-alarm rate, expressed as the in-control average run length (ARL0).
 */

export interface EwmaParams {
  /** Weight of the newest reading, between 0 and 1. Smaller = smoother, slower. */
  lambda: number;
  /** Control limit in standard deviations of the EWMA statistic. */
  limit: number;
}

export interface EwmaResult {
  /** EWMA statistic after each reading. */
  values: number[];
  /** Control limit after each reading (it widens until the EWMA reaches steady state). */
  limits: number[];
  /** Index of the first reading at which |EWMA| crossed its limit, or null. */
  signalIndex: number | null;
  last: number;
  lastLimit: number;
}

/** Exponentially weighted moving average chart. s_t = lambda*z_t + (1 - lambda)*s_{t-1}, s_0 = 0. */
export function ewma(z: readonly number[], { lambda, limit }: EwmaParams): EwmaResult {
  const values: number[] = [];
  const limits: number[] = [];
  let s = 0;
  let signalIndex: number | null = null;
  for (let t = 0; t < z.length; t++) {
    s = lambda * z[t] + (1 - lambda) * s;
    // Exact standard deviation of s_t for independent unit-variance readings.
    const sd = Math.sqrt((lambda / (2 - lambda)) * (1 - (1 - lambda) ** (2 * (t + 1))));
    values.push(s);
    limits.push(limit * sd);
    if (signalIndex === null && Math.abs(s) > limit * sd) signalIndex = t;
  }
  return { values, limits, signalIndex, last: values.length > 0 ? s : 0, lastLimit: limits.length > 0 ? limits[limits.length - 1] : 0 };
}

export interface CusumParams {
  /** Reference value (allowance): half the shift, in standard deviations, to detect fastest. */
  k: number;
  /** Decision interval. */
  h: number;
}

export interface CusumResult {
  /** Upper cumulative sum after each reading. */
  high: number[];
  /** Lower cumulative sum after each reading (kept positive). */
  low: number[];
  /** Index of the first reading at which either sum crossed h, or null. */
  signalIndex: number | null;
  direction: 'high' | 'low' | null;
}

/** Two-sided tabular CUSUM. C+_t = max(0, C+_{t-1} + z_t - k); C-_t = max(0, C-_{t-1} - z_t - k). */
export function cusum(z: readonly number[], { k, h }: CusumParams): CusumResult {
  const high: number[] = [];
  const low: number[] = [];
  let up = 0;
  let down = 0;
  let signalIndex: number | null = null;
  let direction: CusumResult['direction'] = null;
  for (let t = 0; t < z.length; t++) {
    up = Math.max(0, up + z[t] - k);
    down = Math.max(0, down - z[t] - k);
    high.push(up);
    low.push(down);
    if (signalIndex === null && (up > h || down > h)) {
      signalIndex = t;
      direction = up > h ? 'high' : 'low';
    }
  }
  return { high, low, signalIndex, direction };
}

/**
 * Counts separate episodes in which a one-sided CUSUM crosses h. After a signal the sum is
 * reset and a new episode can only start once the series has returned to its quiet state
 * (sum back at zero). Used to count awakenings from night-time activity.
 */
export function countEpisodes(z: readonly number[], { k, h }: CusumParams): number {
  let sum = 0;
  let armed = true;
  let episodes = 0;
  for (const value of z) {
    sum = Math.max(0, sum + value - k);
    if (armed && sum > h) {
      episodes += 1;
      armed = false;
    }
    if (!armed && sum === 0) armed = true;
    // Cap the sum so that a long burst does not delay the return to quiet.
    if (!armed) sum = Math.min(sum, h);
  }
  return episodes;
}
