// Offline demo: proves the prototype needs no connection, then serves it.
//
//   node tools/demo-offline.mjs            checks, builds, then serves dashboard and API
//   node tools/demo-offline.mjs --check    checks only (no servers), exit code 1 on failure
//
// What it checks:
//   1. every snapshot of an external source is on disk and matches its recorded SHA-256;
//   2. the data the app bundles is present;
//   3. the database builds from the matrix kept in git;
//   4. the site builds, and the only host the bundle can call is the optional live space
//      weather feed, which falls back to the bundled snapshot;
//   5. with the network blocked, the rules engine and the API still answer.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const checkOnly = process.argv.includes('--check');
const NODE = process.execPath;
const VITE = join('node_modules', 'vite', 'bin', 'vite.js');
const DASHBOARD_PORT = 4173;
const API_PORT = 8787;
const OPTIONAL_LIVE_HOSTS = ['services.swpc.noaa.gov'];

let failures = 0;
const report = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  (${detail})` : ''}`);
};
const run = (args) => spawnSync(NODE, args, { encoding: 'utf8' });

console.log('1. Snapshots of external sources');
const manifest = JSON.parse(readFileSync('data/snapshots/manifest.json', 'utf8'));
let intact = 0;
for (const entry of manifest) {
  const file = join('data/snapshots', entry.file);
  const present = existsSync(file);
  const matches = present && createHash('sha256').update(readFileSync(file)).digest('hex') === entry.sha256;
  if (matches) intact += 1;
  else report(false, entry.file, present ? 'content differs from the manifest' : 'missing');
}
report(intact === manifest.length, `${intact} of ${manifest.length} snapshots present and matching their SHA-256`, [...new Set(manifest.map((m) => m.source))].join(', '));

console.log('2. Data bundled with the app');
for (const file of [
  'data/matrix/rules.json',
  'data/matrix/evidence.json',
  'data/matrix/sources.resolved.json',
  'data/matrix/verification.json',
  'data/snapshots/space-weather.json',
  'data/snapshots/mmash/derived.json',
  'data/validation/drift-calibration.json',
  'public/models/body.glb',
  'reference_map.csv',
]) {
  report(existsSync(file), file, existsSync(file) ? `${(statSync(file).size / 1024).toFixed(0)} KB` : 'missing');
}

console.log('3. Database from the matrix');
const db = run(['tools/db/build.mjs', 'data/matrix', 'tools/db/migrations', 'data/crew-health.db']);
report(db.status === 0, 'data/crew-health.db', (db.stdout.split('\n').find((line) => line.includes('rules')) ?? db.stderr).trim().slice(0, 90));

console.log('4. Site build and the hosts it can call');
const build = run([VITE, 'build']);
report(build.status === 0, 'vite build', build.status === 0 ? 'dist/' : build.stderr.trim().slice(0, 120));
if (build.status === 0) report(existsSync('dist/models/body.glb'), 'dist/models/body.glb', '3D model shipped with the site');

// The app's source is searched for anything that opens a connection. Links to sources
// (evidence, attribution) are not requests, so the bundle text is not what is scanned.
const sourceFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []));
const NETWORK_CALL = /\bfetch(?:Impl)?\(|XMLHttpRequest|new WebSocket|EventSource|sendBeacon/;
const callers = sourceFiles('src').filter((file) => NETWORK_CALL.test(readFileSync(file, 'utf8')));
const calledHosts = [...new Set(callers.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase())))];
const unexpected = calledHosts.filter((host) => !OPTIONAL_LIVE_HOSTS.includes(host));
report(
  unexpected.length === 0 && callers.length <= 1,
  'network requests in the app source',
  `${callers.length} file (${callers.join(', ').replace(/\\/g, '/')}) -> ${calledHosts.join(', ') || 'no external host'}: optional live feed, snapshot fallback`,
);
if (unexpected.length > 0) console.log(`        unexpected hosts: ${unexpected.join(', ')}`);

console.log('5. Rules engine and API with the network blocked');
const realFetch = globalThis.fetch;
let blocked = 0;
globalThis.fetch = () => {
  blocked += 1;
  return Promise.reject(new Error('network blocked by the offline check'));
};
const { createServer } = await import('vite');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { MissionRuntime, CREW_ID } = await vite.ssrLoadModule('/src/api/runtime.ts');
  const { handle } = await vite.ssrLoadModule('/src/api/handlers.ts');
  const { loadSpaceWeather } = await vite.ssrLoadModule('/src/data/spaceWeather.ts');
  const runtime = new MissionRuntime();
  const get = (path) => handle(runtime, { method: 'GET', path });
  report(get('/rules').body.count > 0, 'GET /rules', `${get('/rules').body.count} rules`);
  report(get('/evidence').body.count > 0, 'GET /evidence', `${get('/evidence').body.count} claims`);
  report(get(`/state/${CREW_ID}`).status === 200, `GET /state/${CREW_ID}`, `triage: ${get(`/state/${CREW_ID}`).body.triage.headline}`);
  report(get('/radiation/now').body.origin === 'snapshot', 'GET /radiation/now', `from the snapshot, level S${get('/radiation/now').body.noaaScale.level}`);
  handle(runtime, { method: 'POST', path: '/simulate', body: { scenario: 'co2-fault', hours: 12 } });
  const alerts = get('/alerts').body.alerts;
  report(alerts.length > 0 && alerts.every((a) => a.provenance_class && a.source.url), 'GET /alerts', `${alerts.length} alert(s), each with provenance class and source`);
  const weather = await loadSpaceWeather();
  report(weather.origin === 'snapshot' && blocked > 0, 'live feed blocked, snapshot used', `${blocked} network call(s) attempted and refused`);
} finally {
  await vite.close();
  globalThis.fetch = realFetch;
}

console.log(failures === 0 ? '\nOffline check passed: the demo runs with no connection.' : `\nOffline check FAILED: ${failures} problem(s).`);
if (checkOnly || failures > 0) process.exit(failures === 0 ? 0 : 1);

console.log(`\nStarting the demo. You can disconnect from the network now.\n  Dashboard: http://localhost:${DASHBOARD_PORT}\n  API:       http://localhost:${API_PORT}\nPress Ctrl+C to stop.\n`);
const children = [
  spawn(NODE, [VITE, 'preview', '--port', String(DASHBOARD_PORT), '--strictPort'], { stdio: 'inherit' }),
  spawn(NODE, ['server/index.mjs', String(API_PORT), 'data/crew-health.db'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
