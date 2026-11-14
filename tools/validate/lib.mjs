// Shared helpers for the validation scripts: a seeded random generator (so every number in
// METHODS.md is reproduced exactly by re-running the command) and small statistics.

export function generator(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) * Math.cos(2 * Math.PI * uniform());
  return { uniform, gaussian, integer: (n) => Math.floor(uniform() * n) };
}

export const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

export function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export const median = (values) => quantile(values, 0.5);

/** Ranks with ties averaged. */
function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    for (let k = i; k <= j; k++) out[order[k].index] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function pearson(x, y) {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export const spearman = (x, y) => pearson(ranks(x), ranks(y));

/** Percentile bootstrap interval of a statistic of paired data, resampling pairs. */
export function bootstrapInterval(x, y, statistic, random, resamples = 4000, level = 0.95) {
  const values = [];
  for (let b = 0; b < resamples; b++) {
    const xs = [];
    const ys = [];
    for (let i = 0; i < x.length; i++) {
      const pick = random.integer(x.length);
      xs.push(x[pick]);
      ys.push(y[pick]);
    }
    const value = statistic(xs, ys);
    if (Number.isFinite(value)) values.push(value);
  }
  return [quantile(values, (1 - level) / 2), quantile(values, 1 - (1 - level) / 2)];
}

export const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
