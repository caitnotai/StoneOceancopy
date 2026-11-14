// Checks the statistics pipeline against real human data (MMASH, PhysioNet).
//
//   node tools/validate/mmash.mjs <derived.json> <drift-calibration.json> <output json>
//
// MMASH is 22 healthy young men recorded for about one day on Earth. It can show whether
// the pipeline behaves on real physiological signals; it cannot show anything about
// spaceflight. Three checks:
//   A. Empirical-Bayes baseline: does shrinkage predict a person's level better than their
//      raw mean when readings are few, and are the predictive intervals calibrated?
//   B. Drift detectors on a signal with no injected change: how far is the real false-alarm
//      rate from the nominal one?
//   C. Backtest on sleep disturbance: do CUSUM episodes on night-time activity agree with
//      the awakenings and wake time reported by the dataset?
import { readFileSync, writeFileSync } from 'node:fs';
import { fitBaseline, fitPopulation, predictiveInterval, standardize } from '../../src/domain/stats/baseline.ts';
import { countEpisodes, cusum, ewma } from '../../src/domain/stats/drift.ts';
import { bootstrapInterval, generator, mean, median, pearson, quantile, round, spearman } from './lib.mjs';

const [derivedFile, calibrationFile, outFile] = process.argv.slice(2);
if (!derivedFile || !calibrationFile || !outFile) {
  console.error('Usage: node tools/validate/mmash.mjs <derived.json> <drift-calibration.json> <output json>');
  process.exit(1);
}
const { subjects } = JSON.parse(readFileSync(derivedFile, 'utf8'));
const calibration = JSON.parse(readFileSync(calibrationFile, 'utf8'));
const caution = calibration.levels.caution;
const EWMA = { lambda: calibration.ewma.lambda, limit: caution.ewmaLimit };
const CUSUM = { k: calibration.cusum.k, h: caution.cusumH };
const SEED = 20261116;
const result = { seed: SEED, subjects: subjects.length };

// ---------- A. Empirical-Bayes baseline on hourly heart rate ----------
const hourly = subjects.map((s) => s.hourlyHr.map(([, value]) => value)).filter((values) => values.length >= 12);
const population = fitPopulation(hourly, 'MMASH hourly mean heart rate');
console.log(`A. Hourly mean heart rate, ${hourly.length} subjects, ${hourly.reduce((a, v) => a + v.length, 0)} subject-hours`);
console.log(`   population: mean ${round(population.mean, 1)} bpm, between-subject SD ${round(population.betweenSd, 1)}, within-subject SD ${round(population.withinSd, 1)}`);

const random = generator(SEED);
const REPEATS = 300;
const LEVELS = [0.5, 0.8, 0.9, 0.95, 0.99];
result.baseline = { subjects: hourly.length, population: { mean: round(population.mean, 2), betweenSd: round(population.betweenSd, 2), withinSd: round(population.withinSd, 2) }, byReadings: {}, coverage: {} };
console.log('   readings  RMSE raw mean  RMSE shrunk  error reduction  mean shrinkage');
for (const k of [1, 2, 3, 5, 8]) {
  let raw = 0;
  let shrunk = 0;
  let count = 0;
  let shrinkage = 0;
  const hits = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  let predictions = 0;
  hourly.forEach((values, i) => {
    // The prior never sees the person being predicted.
    const prior = fitPopulation(hourly.filter((_, j) => j !== i), 'leave-one-subject-out');
    for (let r = 0; r < REPEATS; r++) {
      const shuffled = values.map((v) => [random.uniform(), v]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
      const own = shuffled.slice(0, k);
      const rest = shuffled.slice(k);
      const truth = mean(rest);
      const baseline = fitBaseline(own, prior);
      raw += (mean(own) - truth) ** 2;
      shrunk += (baseline.mean - truth) ** 2;
      shrinkage += baseline.shrinkage;
      count += 1;
      if (k === 5) {
        for (const level of LEVELS) {
          const [low, high] = predictiveInterval(baseline, level);
          hits[level] += rest.filter((v) => v >= low && v <= high).length;
        }
        predictions += rest.length;
      }
    }
  });
  const row = { rmseRaw: round(Math.sqrt(raw / count), 2), rmseShrunk: round(Math.sqrt(shrunk / count), 2), reduction: round(1 - Math.sqrt(shrunk / raw), 3), shrinkage: round(shrinkage / count, 3) };
  result.baseline.byReadings[k] = row;
  console.log(`   ${String(k).padStart(5)}     ${String(row.rmseRaw).padStart(8)}     ${String(row.rmseShrunk).padStart(8)}     ${String((row.reduction * 100).toFixed(1) + '%').padStart(8)}        ${row.shrinkage}`);
  if (k === 5) for (const level of LEVELS) result.baseline.coverage[level] = round(hits[level] / predictions, 3);
}
console.log(`   coverage of predictive intervals from 5 readings (nominal -> observed): ${LEVELS.map((l) => `${l} -> ${result.baseline.coverage[l]}`).join(', ')}`);

// ---------- B. False alarms on real night-time heart rate ----------
// Five-minute means of in-bed heart rate. Even-numbered blocks estimate the baseline and
// odd-numbered blocks are monitored, so both halves cover the whole night.
const nights = subjects.filter((s) => s.night.hr.filter((v) => v !== null).length >= 120);
let evaluations = 0;
const alarms = { ewma: 0, cusum: 0 };
const lag1 = [];
for (const s of nights) {
  const blocks = [];
  for (let i = 0; i + 5 <= s.night.hr.length; i += 5) {
    const values = s.night.hr.slice(i, i + 5).filter((v) => v !== null);
    if (values.length >= 3) blocks.push(mean(values));
  }
  const baseline = fitBaseline(blocks.filter((_, i) => i % 2 === 0));
  const z = blocks.filter((_, i) => i % 2 === 1).map((v) => standardize(v, baseline));
  lag1.push(pearson(z.slice(0, -1), z.slice(1)));
  // Run length: restart each detector after a signal and count the signals.
  for (const [name, detect] of [['ewma', (x) => ewma(x, EWMA).signalIndex], ['cusum', (x) => cusum(x, CUSUM).signalIndex]]) {
    let start = 0;
    while (start < z.length) {
      const signal = detect(z.slice(start));
      if (signal === null) break;
      alarms[name] += 1;
      start += signal + 1;
    }
  }
  evaluations += z.length;
}
const nominal = 1 / caution.targetArl0;
result.falseAlarms = {
  subjects: nights.length,
  evaluations,
  nominalRate: nominal,
  ewmaRate: round(alarms.ewma / evaluations, 4),
  cusumRate: round(alarms.cusum / evaluations, 4),
  medianLag1Autocorrelation: round(median(lag1), 2),
};
console.log(`\nB. In-bed heart rate, 5-minute means, ${nights.length} subjects, ${evaluations} monitored blocks, no change injected`);
console.log(`   nominal false-alarm rate ${nominal} per reading; observed: EWMA ${result.falseAlarms.ewmaRate} (${round(result.falseAlarms.ewmaRate / nominal, 1)}x), CUSUM ${result.falseAlarms.cusumRate} (${round(result.falseAlarms.cusumRate / nominal, 1)}x)`);
console.log(`   median lag-1 autocorrelation of the monitored series: ${result.falseAlarms.medianLag1Autocorrelation}`);

// ---------- C. Backtest: sleep disturbance from night-time activity ----------
const sleepers = subjects.filter((s) => s.night.activity.length >= 120 && s.sleep.length > 0);
const detected = [];
const awakenings = [];
const waso = [];
const active = [];
for (const s of sleepers) {
  const main = s.sleep.slice().sort((a, b) => b.minutesInBed - a.minutesInBed)[0];
  const signal = s.night.activity.map((v) => Math.log1p(v));
  // Robust standardization against the person's own quiet level during the night.
  const centre = median(signal);
  const spread = Math.max(1.4826 * median(signal.map((v) => Math.abs(v - centre))), 0.5);
  const z = signal.map((v) => (v - centre) / spread);
  detected.push(countEpisodes(z, CUSUM));
  awakenings.push(main.awakenings);
  waso.push(main.wasoMin);
  active.push(z.filter((v) => v > CUSUM.k).length);
}
const bootstrap = generator(SEED + 1);
const rhoAwakenings = spearman(detected, awakenings);
const rhoWaso = spearman(active, waso);
result.sleepBacktest = {
  subjects: sleepers.length,
  episodesVsReportedAwakenings: { spearman: round(rhoAwakenings, 2), ci95: bootstrapInterval(detected, awakenings, spearman, bootstrap).map((v) => round(v, 2)) },
  activeMinutesVsWaso: { spearman: round(rhoWaso, 2), ci95: bootstrapInterval(active, waso, spearman, bootstrap).map((v) => round(v, 2)) },
  medianDetectedEpisodes: median(detected),
  medianReportedAwakenings: median(awakenings),
  detectedRange: [Math.min(...detected), Math.max(...detected)],
  reportedRange: [Math.min(...awakenings), Math.max(...awakenings)],
  wasoQuartiles: [quantile(waso, 0.25), quantile(waso, 0.75)],
};
const b = result.sleepBacktest;
console.log(`\nC. Sleep disturbance backtest, ${sleepers.length} subjects with a recorded night`);
console.log(`   CUSUM episodes vs reported awakenings: Spearman ${b.episodesVsReportedAwakenings.spearman} [95% CI ${b.episodesVsReportedAwakenings.ci95.join(', ')}]; median ${b.medianDetectedEpisodes} detected vs ${b.medianReportedAwakenings} reported`);
console.log(`   minutes above the reference vs reported wake after sleep onset: Spearman ${b.activeMinutesVsWaso.spearman} [95% CI ${b.activeMinutesVsWaso.ci95.join(', ')}]`);

writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
console.log(`\n-> ${outFile}`);
