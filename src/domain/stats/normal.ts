/**
 * Standard normal distribution. Self-contained on purpose: the files in `stats/` import
 * each other with explicit `.ts` extensions and nothing else, so that the validation
 * scripts in `tools/validate/` can run them directly with Node.
 */

/** P(Z <= z). Abramowitz and Stegun 7.1.26; absolute error below 1.5e-7. */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Inverse of the CDF (Acklam's rational approximation; relative error below 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface Summary {
  n: number;
  mean: number;
  /** Unbiased sample variance; 0 when n < 2. */
  variance: number;
}

export function summarize(values: readonly number[]): Summary {
  const n = values.length;
  if (n === 0) return { n: 0, mean: Number.NaN, variance: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n < 2 ? 0 : values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { n, mean, variance };
}
