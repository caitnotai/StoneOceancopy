// Refreshes the space weather snapshot the app ships with.
//
//   node tools/ingest/space-weather.mjs <snapshot dir>
//
// Reads the GOES integral proton flux (NOAA SWPC) and the solar energetic particle events
// on record (NASA DONKI), keeps the raw responses, and writes one compact file,
// `space-weather.json`, that the app bundles so that it works with no connection.
// If a source does not answer, the raw snapshot already on disk is used instead.
//
// DONKI needs a key from api.nasa.gov: set NASA_API_KEY. Without it the shared DEMO_KEY is
// tried, which is rate-limited and often refused.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node tools/ingest/space-weather.mjs <snapshot dir>');
  process.exit(1);
}

const GOES_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-7-day.json';
const GOES_FILE = 'swpc/integral-protons-7-day.json';
const DONKI_FILE = 'donki/sep-events.json';
const HOUR = 3_600_000;

const manifestFile = join(outDir, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : [];

/** Fetches a JSON source and stores the raw response; falls back to the copy on disk. */
async function refresh(file, url, label) {
  const path = join(outDir, file);
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'health-monitoring-prototype/0.1' }, signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    JSON.parse(text);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    const entry = { file, source: file.split('/')[0], url: url.replace(/api_key=[^&]+/, 'api_key=***'), method: 'GET', fetchedAt: new Date().toISOString(), bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') };
    const index = manifest.findIndex((m) => m.file === file);
    if (index >= 0) manifest[index] = entry;
    else manifest.push(entry);
    console.log(`fetched   ${label}`);
    return { data: JSON.parse(text), fetchedAt: entry.fetchedAt, url: entry.url };
  } catch (error) {
    if (!existsSync(path)) throw new Error(`${label}: no answer and no snapshot on disk (${error.message})`);
    const previous = manifest.find((m) => m.file === file);
    console.log(`snapshot  ${label} (source did not answer: ${error.message})`);
    return { data: JSON.parse(readFileSync(path, 'utf8')), fetchedAt: previous?.fetchedAt ?? null, url: previous?.url ?? url };
  }
}

// ---- GOES protons at 10 MeV or more ----
const goes = await refresh(GOES_FILE, GOES_URL, 'GOES integral protons, 7 days');
const protons = goes.data
  .filter((r) => r.energy === '>=10 MeV' && Number.isFinite(r.flux))
  .map((r) => ({ t: Date.parse(r.time_tag), pfu: r.flux }))
  .sort((a, b) => a.t - b.t);
const last = protons[protons.length - 1];
// Full 5-minute resolution for the last 24 hours (enough to detect an event in progress);
// hourly means before that.
const recent = protons.filter((p) => p.t > last.t - 24 * HOUR);
const hourly = new Map();
for (const p of protons.filter((x) => x.t <= last.t - 24 * HOUR)) {
  const hour = Math.floor(p.t / HOUR) * HOUR;
  const bucket = hourly.get(hour) ?? { sum: 0, n: 0 };
  bucket.sum += p.pfu;
  bucket.n += 1;
  hourly.set(hour, bucket);
}
const round = (v) => Math.round(v * 1000) / 1000;
const flux = [...[...hourly].map(([t, b]) => [t, round(b.sum / b.n)]), ...recent.map((p) => [p.t, round(p.pfu)])];

// ---- DONKI solar energetic particle events ----
const end = new Date();
const start = new Date(end.getTime() - 60 * 24 * HOUR);
const day = (d) => d.toISOString().slice(0, 10);
const key = process.env.NASA_API_KEY ?? 'DEMO_KEY';
// The first run seeds this file from the smoke-test snapshot (May-June 2024).
const seed = join(outDir, 'donki/sep-2024-05_06.api-nasa.json');
if (!existsSync(join(outDir, DONKI_FILE)) && existsSync(seed)) {
  writeFileSync(join(outDir, DONKI_FILE), readFileSync(seed));
  manifest.push({ ...(manifest.find((m) => m.file === 'donki/sep-2024-05_06.api-nasa.json') ?? {}), file: DONKI_FILE });
}
const donki = await refresh(DONKI_FILE, `https://api.nasa.gov/DONKI/SEP?startDate=${day(start)}&endDate=${day(end)}&api_key=${key}`, 'DONKI SEP events');
const window = donki.url.match(/startDate=([\d-]+)&endDate=([\d-]+)/);
const events = donki.data
  .map((e) => ({ id: e.sepID, time: e.eventTime, instruments: (e.instruments ?? []).map((i) => i.displayName), link: e.link }))
  .sort((a, b) => b.time.localeCompare(a.time));

const compact = {
  note: 'Offline snapshot of real space weather data, bundled with the app. Refresh with: npm run ingest:space-weather',
  goes: { source: 'NOAA SWPC, GOES primary satellite, integral proton flux', url: GOES_URL, satellite: goes.data[0]?.satellite ?? null, energy: '>=10 MeV', unit: 'pfu', fetchedAt: goes.fetchedAt, flux },
  donki: { source: 'NASA DONKI, solar energetic particle (SEP) events', fetchedAt: donki.fetchedAt, from: window?.[1] ?? null, to: window?.[2] ?? null, events },
};
writeFileSync(join(outDir, 'space-weather.json'), JSON.stringify(compact) + '\n');
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`space-weather.json: ${flux.length} flux points up to ${new Date(last.t).toISOString()}, latest ${round(last.pfu)} pfu; ${events.length} SEP events (${compact.donki.from} to ${compact.donki.to})`);
