import { describe, expect, it } from 'vitest';
import { fitBaseline, fitPopulation, predictiveInterval, standardize } from '../src/domain/stats/baseline';
import { CO2_HEADACHE_PRIOR, headacheRisk, headacheRiskInterval, oneHourMeanExceeds } from '../src/domain/stats/co2';
import { countEpisodes, cusum, ewma } from '../src/domain/stats/drift';
import { normalCdf, normalQuantile, summarize } from '../src/domain/stats/normal';

/** Deterministic standard normal draws. */
function gaussianStream(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) * Math.cos(2 * Math.PI * uniform());
}

describe('normal distribution', () => {
  it('matches known values of the CDF and its inverse', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-3)).toBeCloseTo(0.00135, 5);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 5);
    for (const p of [0.01, 0.2, 0.5, 0.9, 0.999]) expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
  });

  it('summarizes a sample', () => {
    expect(summarize([2, 4, 4, 4, 5, 5, 7, 9])).toMatchObject({ n: 8, mean: 5 });
    expect(summarize([2, 4, 4, 4, 5, 5, 7, 9]).variance).toBeCloseTo(32 / 7, 10);
    expect(summarize([3]).variance).toBe(0);
  });
});

describe('empirical-Bayes baseline', () => {
  // 40 subjects, true mu = 60, tau = 6, sigma = 4, 12 readings each.
  const draw = gaussianStream(7);
  const truth = Array.from({ length: 40 }, () => 60 + 6 * draw());
  const groups = truth.map((theta) => Array.from({ length: 12 }, () => theta + 4 * draw()));
  const prior = fitPopulation(groups, 'synthetic');

  it('recovers the population parameters by the method of moments', () => {
    expect(prior.subjects).toBe(40);
    expect(prior.mean).toBeGreaterThan(58);
    expect(prior.mean).toBeLessThan(62);
    expect(prior.withinSd).toBeGreaterThan(3.6);
    expect(prior.withinSd).toBeLessThan(4.4);
    expect(prior.betweenSd).toBeGreaterThan(4.5);
    expect(prior.betweenSd).toBeLessThan(7.5);
  });

  it('leans on the population with few readings and on the person with many', () => {
    const few = fitBaseline([75, 77], prior);
    const many = fitBaseline(Array.from({ length: 200 }, (_, i) => 76 + (i % 2 === 0 ? 1 : -1)), prior);
    expect(few.method).toBe('empirical-bayes');
    expect(few.shrinkage).toBeGreaterThan(many.shrinkage);
    expect(few.mean).toBeLessThan(76); // pulled toward the population mean of about 60
    expect(few.mean).toBeGreaterThan(prior.mean);
    expect(many.mean).toBeCloseTo(76, 0);
    expect(many.shrinkage).toBeLessThan(0.02);
  });

  it('with no readings, the baseline is the population itself', () => {
    const none = fitBaseline([], prior);
    expect(none).toMatchObject({ n: 0, shrinkage: 1, mean: prior.mean });
    expect(none.sd).toBeCloseTo(Math.hypot(prior.withinSd, prior.betweenSd), 10);
  });

  it('predicts the true level better than the raw mean when readings are few', () => {
    // 600 new people drawn from the same population, with one or two readings each.
    const d = gaussianStream(23);
    for (const readings of [1, 2]) {
      let rawError = 0;
      let shrunkError = 0;
      for (let i = 0; i < 600; i++) {
        const theta = 60 + 6 * d();
        const own = Array.from({ length: readings }, () => theta + 4 * d());
        rawError += (summarize(own).mean - theta) ** 2;
        shrunkError += (fitBaseline(own, prior).mean - theta) ** 2;
      }
      // Theory: the error falls by the shrinkage factor (about 31% with one reading, 18% with two).
      expect(shrunkError / rawError, `${readings} reading(s)`).toBeLessThan(0.95);
    }
  });

  it('gives predictive intervals with about the stated coverage', () => {
    const d = gaussianStream(11);
    let inside = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      const theta = prior.mean + prior.betweenSd * d();
      const baseline = fitBaseline(Array.from({ length: 6 }, () => theta + prior.withinSd * d()), prior);
      const [low, high] = predictiveInterval(baseline, 0.95);
      const next = theta + prior.withinSd * d();
      if (next >= low && next <= high) inside += 1;
    }
    expect(inside / trials).toBeGreaterThan(0.93);
    expect(inside / trials).toBeLessThan(0.97);
  });

  it('works without a population, from the person alone', () => {
    const b = fitBaseline([7.5, 7.8, 7.2, 7.6, 7.9, 7.4, 7.7]);
    expect(b).toMatchObject({ method: 'individual', shrinkage: 0, n: 7 });
    expect(b.mean).toBeCloseTo(7.586, 2);
    expect(standardize(b.mean + 2 * b.sd, b)).toBeCloseTo(2, 10);
    expect(() => fitBaseline([7.5])).toThrow();
  });
});

describe('drift detection', () => {
  const params = { ewma: { lambda: 0.2, limit: 2.6 }, cusum: { k: 0.5, h: 4 } };

  it('EWMA: the limit widens to its steady state and a sustained shift is caught', () => {
    const quiet = ewma([0.2, -0.4, 0.1, -0.1, 0.3, -0.2], params.ewma);
    expect(quiet.signalIndex).toBeNull();
    expect(quiet.limits[0]).toBeLessThan(quiet.limits[5]);
    expect(quiet.limits[0]).toBeCloseTo(2.6 * 0.2, 10);
    const steady = 2.6 * Math.sqrt(0.2 / 1.8);
    expect(ewma(new Array(200).fill(0), params.ewma).lastLimit).toBeCloseTo(steady, 6);

    const shifted = ewma([0.1, -0.2, 0.3, ...new Array(12).fill(1.5)], params.ewma);
    expect(shifted.signalIndex).not.toBeNull();
    expect(shifted.signalIndex!).toBeGreaterThanOrEqual(3);
    expect(shifted.signalIndex!).toBeLessThan(10);
  });

  it('CUSUM: ignores noise around zero and reports the direction of a sustained shift', () => {
    expect(cusum([0.4, -0.3, 0.2, -0.5, 0.1], params.cusum)).toMatchObject({ signalIndex: null, direction: null });
    const up = cusum(new Array(10).fill(1.5), params.cusum);
    expect(up).toMatchObject({ signalIndex: 4, direction: 'high' }); // 5 steps of +1.0 exceed h = 4
    const down = cusum(new Array(10).fill(-1.5), params.cusum);
    expect(down).toMatchObject({ signalIndex: 4, direction: 'low' });
  });

  it('a single outlier does not trigger either detector', () => {
    const spike = [0, 0, 0, 3.2, 0, 0, 0, 0];
    expect(ewma(spike, params.ewma).signalIndex).toBeNull();
    expect(cusum(spike, params.cusum).signalIndex).toBeNull();
  });

  it('counts separate bursts as separate episodes', () => {
    const burst = new Array(6).fill(3);
    const quiet = new Array(15).fill(-1);
    expect(countEpisodes([...quiet, ...burst, ...quiet, ...burst, ...quiet, ...burst], params.cusum)).toBe(3);
    expect(countEpisodes(new Array(60).fill(-1), params.cusum)).toBe(0);
    expect(countEpisodes(new Array(60).fill(3), params.cusum)).toBe(1); // one long burst is one episode
  });
});

describe('cabin CO2 model', () => {
  it('applies the hard rule at 3 mmHg', () => {
    expect(oneHourMeanExceeds(3.0)).toBe(false);
    expect(oneHourMeanExceeds(3.01)).toBe(true);
  });

  it('reproduces the published anchors: about 1% at 2.5 mmHg and 1.4% at 3 mmHg', () => {
    expect(headacheRisk(2.5)).toBeCloseTo(0.01, 6);
    expect(headacheRisk(3.0)).toBeCloseTo(0.0141, 3);
    expect(headacheRisk(2.0)).toBeLessThan(0.01);
  });

  it('doubles the odds for each extra mmHg', () => {
    const odds = (p: number): number => p / (1 - p);
    expect(odds(headacheRisk(4)) / odds(headacheRisk(3))).toBeCloseTo(CO2_HEADACHE_PRIOR.oddsRatioPerMmHg, 8);
  });

  it('widens its interval away from the anchor and collapses on it', () => {
    const [low, high] = headacheRiskInterval(4.5);
    expect(low).toBeLessThan(headacheRisk(4.5));
    expect(high).toBeGreaterThan(headacheRisk(4.5));
    const [a, b] = headacheRiskInterval(2.5);
    expect(b - a).toBeCloseTo(0, 10);
  });
});
