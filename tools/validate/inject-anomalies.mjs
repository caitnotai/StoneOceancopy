// Sensitivity and false alarms of the baseline + drift pipeline, by anomaly injection.
//
//   node tools/validate/inject-anomalies.mjs <drift-calibration.json> <output json>
//
// Each simulated person has a true level and noise. Their baseline is ESTIMATED from a
// short baseline period (so the estimation error is part of the test), then the monitoring
// period is run through the three rules the app uses, at the operational limits (calibrated
// with an estimated baseline): EWMA, CUSUM and the single-value rule. A step shift of a given size, in within-person standard deviations,
// is injected at the start of the monitoring period. With no shift, any signal is a false
// alarm. The textbook limits are run too, to show why they are not used.
import { readFileSync, writeFileSync } from 'node:fs';
import { fitBaseline, standardize } from '../../src/domain/stats/baseline.ts';
import { cusum, ewma } from '../../src/domain/stats/drift.ts';
import { generator, median, round } from './lib.mjs';

const [calibrationFile, outFile] = process.argv.slice(2);
if (!calibrationFile || !outFile) {
  console.error('Usage: node tools/validate/inject-anomalies.mjs <drift-calibration.json> <output json>');
  process.exit(1);
}
const calibration = JSON.parse(readFileSync(calibrationFile, 'utf8'));
const caution = calibration.operational.levels.caution;
const critical = calibration.operational.levels.critical;
const textbook = calibration.levels.caution;
const LAMBDA = calibration.ewma.lambda;
const K = calibration.cusum.k;
const BASELINE_DAYS = calibration.operational.baselineReadings;

const RUNS = 5000;
const MONITOR_DAYS = 30;
const SEED = 20261115;

/** One experiment: per detector, the fraction detected within 1, 3, 7 and 30 readings and the median delay. */
function experiment({ baselineDays = BASELINE_DAYS, shift, lambda = LAMBDA, limit = caution.ewmaLimit, h = caution.cusumH, single = caution.singleValueLimit }) {
  const random = generator(SEED + baselineDays * 1000 + Math.round(shift * 100));
  const delays = { ewma: [], cusum: [], single: [], either: [] };
  for (let run = 0; run < RUNS; run++) {
    const own = Array.from({ length: baselineDays }, () => random.gaussian());
    const baseline = fitBaseline(own);
    const z = Array.from({ length: MONITOR_DAYS }, () => standardize(shift + random.gaussian(), baseline));
    const a = ewma(z, { lambda, limit }).signalIndex;
    const b = cusum(z, { k: K, h }).signalIndex;
    const c = z.findIndex((value) => Math.abs(value) > single);
    const delay = [a === null ? Infinity : a + 1, b === null ? Infinity : b + 1, c < 0 ? Infinity : c + 1];
    delays.ewma.push(delay[0]);
    delays.cusum.push(delay[1]);
    delays.single.push(delay[2]);
    delays.either.push(Math.min(...delay));
  }
  const summary = {};
  for (const [name, list] of Object.entries(delays)) {
    const within = (days) => round(list.filter((d) => d <= days).length / list.length, 3);
    const detected = list.filter(Number.isFinite);
    summary[name] = { within1: within(1), within3: within(3), within7: within(7), within30: within(30), medianDelay: detected.length > 0 ? median(detected) : null };
  }
  return summary;
}

const result = {
  seed: SEED,
  runs: RUNS,
  monitorDays: MONITOR_DAYS,
  baselineDays: BASELINE_DAYS,
  limits: {
    lambda: LAMBDA,
    k: K,
    caution: { ewmaLimit: caution.ewmaLimit, cusumH: caution.cusumH, singleValueLimit: caution.singleValueLimit },
    critical: { ewmaLimit: critical.ewmaLimit, cusumH: critical.cusumH, singleValueLimit: critical.singleValueLimit },
  },
  caution: {},
  critical: {},
  sensitivity: { baselineLength: {}, lambda: {} },
  textbook: {},
};

const table = (title, key, limits) => {
  console.log(`\n${title} (EWMA L = ${limits.ewmaLimit}, CUSUM h = ${limits.cusumH}, single value > ${limits.singleValueLimit} SD; any of the three)`);
  console.log('shift (SD)  <=1 day  <=3 days  <=7 days  <=30 days  median delay');
  for (const shift of [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8]) {
    const s = experiment({ shift, limit: limits.ewmaLimit, h: limits.cusumH, single: limits.singleValueLimit }).either;
    result[key][shift] = s;
    console.log(`${String(shift).padStart(6)}      ${String(s.within1).padStart(6)}  ${String(s.within3).padStart(7)}  ${String(s.within7).padStart(7)}  ${String(s.within30).padStart(8)}  ${String(s.medianDelay ?? '-').padStart(6)}`);
  }
};
console.log(`Baseline estimated from ${BASELINE_DAYS} readings, ${MONITOR_DAYS} monitored readings, ${RUNS} runs per row. Shift 0 = false alarms.`);
table('CAUTION limits', 'caution', caution);
table('CRITICAL limits', 'critical', critical);

console.log('\nSensitivity to the length of the baseline period, at the caution limits (false alarm within 30 days; detection of a 2 SD shift within 7 days):');
for (const days of [5, 7, 10, 14, 28]) {
  const none = experiment({ baselineDays: days, shift: 0 }).either;
  const shifted = experiment({ baselineDays: days, shift: 2 }).either;
  result.sensitivity.baselineLength[days] = { falseAlarm30: none.within30, detect7: shifted.within7 };
  console.log(`  baseline ${String(days).padStart(2)} readings: false alarm ${none.within30}, detection ${shifted.within7}`);
}

console.log('\nSensitivity to the EWMA weight lambda, at the caution limit, EWMA alone (false alarm within 30 days; detection of 2 SD within 7 days):');
for (const lambda of [0.1, 0.2, 0.3, 0.5]) {
  const none = experiment({ shift: 0, lambda }).ewma;
  const shifted = experiment({ shift: 2, lambda }).ewma;
  result.sensitivity.lambda[lambda] = { falseAlarm30: none.within30, detect7: shifted.within7 };
  console.log(`  lambda ${lambda}: false alarm ${none.within30}, detection ${shifted.within7}`);
}

// A jump that arrives late: 19 quiet readings, then a step. By then the EWMA limit has
// widened to its settled value, so one extreme reading barely moves it. This is the case
// the single-value rule is there for. The app's status is a state ("beyond the limit now"),
// so detection here means being beyond a limit on that reading.
function lateJump(shift, onset = 20) {
  const random = generator(SEED + 500000 + Math.round(shift * 100));
  const hits = { driftSameDay: 0, driftWithin3: 0, allSameDay: 0, allWithin3: 0 };
  for (let run = 0; run < RUNS; run++) {
    const own = Array.from({ length: BASELINE_DAYS }, () => random.gaussian());
    const baseline = fitBaseline(own);
    const z = Array.from({ length: MONITOR_DAYS }, (_, i) => standardize((i >= onset - 1 ? shift : 0) + random.gaussian(), baseline));
    const e = ewma(z, { lambda: LAMBDA, limit: caution.ewmaLimit });
    const c = cusum(z, { k: K, h: caution.cusumH });
    const drift = (i) => Math.abs(e.values[i]) > e.limits[i] || c.high[i] > caution.cusumH || c.low[i] > caution.cusumH;
    const all = (i) => drift(i) || Math.abs(z[i]) > caution.singleValueLimit;
    const days = [onset - 1, onset, onset + 1];
    if (drift(days[0])) hits.driftSameDay += 1;
    if (days.some(drift)) hits.driftWithin3 += 1;
    if (all(days[0])) hits.allSameDay += 1;
    if (days.some(all)) hits.allWithin3 += 1;
  }
  return Object.fromEntries(Object.entries(hits).map(([name, count]) => [name, round(count / RUNS, 3)]));
}

result.lateJump = { onsetReading: 20, bySize: {} };
console.log('');
console.log('A jump on reading 20, after 19 quiet readings, at the caution limits (flagged on the same reading / within 3 readings):');
console.log('jump (SD)   EWMA + CUSUM alone      with the single-value rule');
for (const shift of [3, 4, 5, 6, 8]) {
  const row = lateJump(shift);
  result.lateJump.bySize[shift] = row;
  console.log(`${String(shift).padStart(6)}      ${String(row.driftSameDay).padStart(5)} / ${String(row.driftWithin3).padEnd(5)}          ${String(row.allSameDay).padStart(5)} / ${row.allWithin3}`);
}

const book = { ewmaLimit: textbook.ewmaLimit, cusumH: textbook.cusumH };
// The textbook scheme is EWMA and CUSUM alone.
const bookNone = experiment({ shift: 0, limit: book.ewmaLimit, h: book.cusumH, single: Infinity }).either;
const bookShift = experiment({ shift: 2, limit: book.ewmaLimit, h: book.cusumH, single: Infinity }).either;
result.textbook = { ...book, arl0: textbook.targetArl0, falseAlarm30: bookNone.within30, detect2sd7: bookShift.within7 };
console.log(`\nFor comparison, the textbook limits for ARL0 = ${textbook.targetArl0} (L = ${book.ewmaLimit}, h = ${book.cusumH}) with the same estimated baseline:`);
console.log(`  false alarm within 30 days ${bookNone.within30}; detection of 2 SD within 7 days ${bookShift.within7}`);

writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
console.log(`-> ${outFile}`);
