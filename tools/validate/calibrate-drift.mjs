// Calibrates the drift detectors for a target false-alarm rate.
//
//   node tools/validate/calibrate-drift.mjs <output json>
//
// For independent standard-normal readings (a person at their baseline), the average run
// length ARL0 is the mean number of readings until a false alarm. For each target ARL0 this
// script finds, by bisection over Monte Carlo runs, the EWMA limit L and the CUSUM decision
// interval h that give it. Seeded: the output is identical on every run.
import { writeFileSync } from 'node:fs';
import { fitBaseline, standardize } from '../../src/domain/stats/baseline.ts';
import { cusum, ewma } from '../../src/domain/stats/drift.ts';
import { generator, mean, round } from './lib.mjs';

const outFile = process.argv[2];
if (!outFile) {
  console.error('Usage: node tools/validate/calibrate-drift.mjs <output json>');
  process.exit(1);
}

const RUNS = 6000;
const MAX_LENGTH = 6000;
const SEED = 20261114;

/** Mean number of in-control readings before `detect` signals (capped at MAX_LENGTH). */
function averageRunLength(detect) {
  const random = generator(SEED);
  const lengths = [];
  for (let run = 0; run < RUNS; run++) {
    // Generate in blocks until the detector signals.
    const z = [];
    let signal = null;
    while (signal === null && z.length < MAX_LENGTH) {
      for (let i = 0; i < 400; i++) z.push(random.gaussian());
      signal = detect(z);
    }
    lengths.push(signal === null ? MAX_LENGTH : signal + 1);
  }
  return mean(lengths);
}

/** Finds the detector parameter that gives the target ARL0; ARL0 grows with the parameter. */
function solve(target, low, high, arlOf) {
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (arlOf(mid) < target) low = mid;
    else high = mid;
  }
  const value = round((low + high) / 2, 3);
  return { value, arl0: round(arlOf(value), 1) };
}

const TARGETS = [
  { name: 'caution', arl0: 100, meaning: 'about one false alarm per 100 readings at baseline' },
  { name: 'critical', arl0: 1000, meaning: 'about one false alarm per 1,000 readings at baseline' },
];
const LAMBDA = 0.2;
const K = 0.5;

const result = { seed: SEED, runs: RUNS, model: 'independent standard-normal readings', ewma: { lambda: LAMBDA }, cusum: { k: K }, levels: {} };
for (const target of TARGETS) {
  const e = solve(target.arl0, 1.5, 4, (limit) => averageRunLength((z) => ewma(z, { lambda: LAMBDA, limit }).signalIndex));
  const c = solve(target.arl0, 2, 9, (h) => averageRunLength((z) => cusum(z, { k: K, h }).signalIndex));
  // Used together, either detector may fire first, so the joint false-alarm rate is higher.
  const joint = averageRunLength((z) => {
    const a = ewma(z, { lambda: LAMBDA, limit: e.value }).signalIndex;
    const b = cusum(z, { k: K, h: c.value }).signalIndex;
    return a === null ? b : b === null ? a : Math.min(a, b);
  });
  result.levels[target.name] = { targetArl0: target.arl0, meaning: target.meaning, ewmaLimit: e.value, ewmaArl0: e.arl0, cusumH: c.value, cusumArl0: c.arl0, jointArl0: round(joint, 1) };
  console.log(`${target.name.padEnd(9)} target ARL0 ${String(target.arl0).padStart(5)} | EWMA lambda ${LAMBDA}, L = ${e.value} (ARL0 ${e.arl0}) | CUSUM k ${K}, h = ${c.value} (ARL0 ${c.arl0}) | either: ARL0 ${round(joint, 1)}`);
}

// ---------- Operational calibration ----------
// The textbook ARL0 assumes the baseline is known exactly. In use it is estimated from a
// short baseline period, and that estimation error behaves like a small permanent shift:
// false alarms are far more frequent than the ARL0 suggests (see inject-anomalies.mjs).
// So the limits the app uses are calibrated under the real conditions instead: baseline
// estimated from BASELINE_READINGS readings, then a monitoring horizon of HORIZON readings,
// for a target probability of at least one false alarm within the horizon.
const BASELINE_READINGS = 14;
const HORIZON = 30;
const OPERATIONAL_RUNS = 30000;

function falseAlarmProbability(detect) {
  const random = generator(SEED + 7);
  let alarms = 0;
  for (let run = 0; run < OPERATIONAL_RUNS; run++) {
    const own = Array.from({ length: BASELINE_READINGS }, () => random.gaussian());
    const baseline = fitBaseline(own);
    const z = Array.from({ length: HORIZON }, () => standardize(random.gaussian(), baseline));
    if (detect(z) !== null) alarms += 1;
  }
  return alarms / OPERATIONAL_RUNS;
}

/** Finds the parameter that gives the target false-alarm probability; it falls as the parameter grows. */
function solveProbability(target, low, high, probabilityOf) {
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;
    if (probabilityOf(mid) > target) low = mid;
    else high = mid;
  }
  const value = round((low + high) / 2, 3);
  return { value, probability: round(probabilityOf(value), 4) };
}

result.operational = { baselineReadings: BASELINE_READINGS, horizonReadings: HORIZON, runs: OPERATIONAL_RUNS, levels: {} };
console.log(`\nOperational calibration: baseline estimated from ${BASELINE_READINGS} readings, probability of a false alarm within ${HORIZON} readings`);
for (const target of [
  { name: 'caution', probability: 0.05 },
  { name: 'critical', probability: 0.005 },
]) {
  // Each detector gets half of the budget, so that used together they stay near the target.
  const each = target.probability / 2;
  const e = solveProbability(each, 1.5, 8, (limit) => falseAlarmProbability((z) => ewma(z, { lambda: LAMBDA, limit }).signalIndex));
  const c = solveProbability(each, 2, 80, (h) => falseAlarmProbability((z) => cusum(z, { k: K, h }).signalIndex));
  const joint = falseAlarmProbability((z) => {
    const a = ewma(z, { lambda: LAMBDA, limit: e.value }).signalIndex;
    const b = cusum(z, { k: K, h: c.value }).signalIndex;
    return a === null ? b : b === null ? a : Math.min(a, b);
  });
  result.operational.levels[target.name] = { targetFalseAlarm: target.probability, ewmaLimit: e.value, ewmaFalseAlarm: e.probability, cusumH: c.value, cusumFalseAlarm: c.probability, jointFalseAlarm: round(joint, 4) };
  console.log(`${target.name.padEnd(9)} target ${target.probability} | EWMA L = ${e.value} (${e.probability}) | CUSUM h = ${c.value} (${c.probability}) | either: ${round(joint, 4)}`);
}

writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
console.log(`-> ${outFile}`);
