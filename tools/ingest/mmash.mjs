// Reduces the MMASH dataset (PhysioNet) to the compact file the validation scripts use.
//
//   node tools/ingest/mmash.mjs <path to MMASH DataPaper folder> <output json>
//
// MMASH: Multilevel Monitoring of Activity and Sleep in Healthy People, v1.0.0.
// 22 healthy young men, about 24 hours each: wrist/chest actigraphy and heart rate at one
// sample per second, plus a sleep summary per night. Download MMASH.zip from
// https://physionet.org/content/mmash/1.0.0/ and unzip it first (see METHODS.md).
//
// The output is an adapted database and is offered under the same licence as the source,
// the Open Database License (ODbL) v1.0, with attribution.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dataDir, outFile] = process.argv.slice(2);
if (!dataDir || !outFile) {
  console.error('Usage: node tools/ingest/mmash.mjs <path to MMASH DataPaper folder> <output json>');
  process.exit(1);
}

const HOUR = 3600;
const VALID_HR = [35, 200];
const MIN_SECONDS_PER_HOUR = 900;
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const rows = (file) => readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1).map((line) => line.split(','));
/** Seconds since midnight of day 1. */
const clock = (day, time) => {
  const [h, m, s = '0'] = time.split(':').map(Number);
  return (Number(day) - 1) * 86400 + h * 3600 + m * 60 + Number(s);
};

const users = readdirSync(dataDir)
  .filter((name) => /^user_\d+$/.test(name) && statSync(join(dataDir, name)).isDirectory())
  .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));

const subjects = [];
for (const user of users) {
  const dir = join(dataDir, user);
  // Actigraph.csv columns: index, Axis1, Axis2, Axis3, Steps, HR, 4 inclinometer flags, Vector Magnitude, day, time
  const seconds = [];
  for (const r of rows(join(dir, 'Actigraph.csv'))) {
    const hr = Number(r[5]);
    const vm = Number(r[10]);
    const t = clock(r[11], r[12]);
    if (Number.isFinite(t)) seconds.push({ t, hr: hr >= VALID_HR[0] && hr <= VALID_HR[1] ? hr : null, vm: Number.isFinite(vm) ? vm : 0 });
  }
  if (seconds.length === 0) continue;
  seconds.sort((a, b) => a.t - b.t);

  // Hourly mean heart rate over the whole recording.
  const buckets = new Map();
  for (const s of seconds) {
    if (s.hr === null) continue;
    const hour = Math.floor(s.t / HOUR);
    const b = buckets.get(hour) ?? { sum: 0, n: 0 };
    b.sum += s.hr;
    b.n += 1;
    buckets.set(hour, b);
  }
  const hourlyHr = [...buckets].filter(([, b]) => b.n >= MIN_SECONDS_PER_HOUR).sort((a, b) => a[0] - b[0]).map(([hour, b]) => [hour, round(b.sum / b.n)]);

  // Sleep periods as reported by the dataset (derived by the ActiGraph software).
  const sleepFile = join(dir, 'sleep.csv');
  const sleep = existsSync(sleepFile)
    ? rows(sleepFile)
        .filter((r) => r.length >= 13 && r[1] !== '')
        .map((r) => ({
          inBed: clock(r[1], r[2]),
          outBed: clock(r[3], r[4]) + (clock(r[3], r[4]) < clock(r[1], r[2]) ? 86400 : 0),
          efficiency: Number(r[8]),
          minutesInBed: Number(r[9]),
          totalSleepMin: Number(r[10]),
          wasoMin: Number(r[11]),
          awakenings: Number(r[12]),
        }))
    : [];

  // Per-minute activity and heart rate during the longest sleep period.
  const main = sleep.slice().sort((a, b) => b.minutesInBed - a.minutesInBed)[0];
  const night = { activity: [], hr: [] };
  if (main) {
    const minutes = new Map();
    for (const s of seconds) {
      if (s.t < main.inBed || s.t >= main.outBed) continue;
      const minute = Math.floor((s.t - main.inBed) / 60);
      const m = minutes.get(minute) ?? { vm: 0, hrSum: 0, hrN: 0 };
      m.vm += s.vm;
      if (s.hr !== null) {
        m.hrSum += s.hr;
        m.hrN += 1;
      }
      minutes.set(minute, m);
    }
    const last = Math.max(...minutes.keys(), 0);
    for (let minute = 0; minute <= last; minute++) {
      const m = minutes.get(minute);
      night.activity.push(m ? round(m.vm, 1) : 0);
      night.hr.push(m && m.hrN >= 20 ? round(m.hrSum / m.hrN, 1) : null);
    }
  }

  const info = rows(join(dir, 'user_info.csv'))[0] ?? [];
  subjects.push({ id: user, age: Number(info[4]) || null, hourlyHr, sleep, night });
  console.log(`${user.padEnd(8)} ${String(seconds.length).padStart(6)} s, ${String(hourlyHr.length).padStart(2)} hourly means, ${sleep.length} sleep period(s), ${night.activity.length} in-bed minutes`);
}

writeFileSync(
  outFile,
  JSON.stringify({
    source: 'MMASH: Multilevel Monitoring of Activity and Sleep in Healthy People, v1.0.0 (PhysioNet), https://doi.org/10.13026/cerq-fc86',
    licence: 'Open Database License (ODbL) v1.0. This file is an adapted database offered under the same licence.',
    description: 'Per subject: hourly mean heart rate; reported sleep periods; per-minute activity (sum of vector magnitude) and mean heart rate during the longest sleep period.',
    subjects,
  }) + '\n',
);
console.log(`${subjects.length} subjects -> ${outFile} (${(statSync(outFile).size / 1024).toFixed(0)} KB)`);
