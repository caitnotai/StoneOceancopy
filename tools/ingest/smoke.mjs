// Smoke test of every external source the project plans to use.
//
//   node tools/ingest/smoke.mjs <snapshot dir>
//
// For each endpoint it records whether it answers, the format, the latency and any rate
// limit the server announces, and it saves the response as an offline snapshot together
// with a manifest (URL, time fetched, SHA-256). Nothing here is needed at run time: the
// app reads the snapshots.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node tools/ingest/smoke.mjs <snapshot dir>');
  process.exit(1);
}

const SWPC = 'https://services.swpc.noaa.gov';
const OSDR = 'https://osdr.nasa.gov/osdr/data/osd';
// A period with well-known solar energetic particle events (May-June 2024).
const SEP_WINDOW = 'startDate=2024-05-01&endDate=2024-06-30';

/** @type {{id: string, source: string, url: string, save?: string, method?: string, body?: unknown}[]} */
const ENDPOINTS = [
  ...['6-hour', '1-day', '3-day', '7-day'].map((span) => ({
    id: `GOES integral protons, ${span}`,
    source: 'swpc',
    url: `${SWPC}/json/goes/primary/integral-protons-${span}.json`,
    save: `swpc/integral-protons-${span}.json`,
  })),
  { id: 'GOES differential protons, 1-day', source: 'swpc', url: `${SWPC}/json/goes/primary/differential-protons-1-day.json`, save: 'swpc/differential-protons-1-day.json' },
  { id: 'NOAA scales, current', source: 'swpc', url: `${SWPC}/products/noaa-scales.json`, save: 'swpc/noaa-scales.json' },
  { id: 'NOAA scales, definition page', source: 'swpc', url: 'https://www.swpc.noaa.gov/noaa-scales-explanation', save: 'swpc/noaa-scales-explanation.html' },
  { id: 'DONKI SEP via api.nasa.gov (DEMO_KEY)', source: 'donki', url: `https://api.nasa.gov/DONKI/SEP?${SEP_WINDOW}&api_key=DEMO_KEY`, save: 'donki/sep-2024-05_06.api-nasa.json' },
  { id: 'DONKI SEP via CCMC (no key)', source: 'donki', url: `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/SEP?${SEP_WINDOW}`, save: 'donki/sep-2024-05_06.ccmc.json' },
  ...[569, 570, 571, 575].map((n) => ({ id: `OSDR file list, OSD-${n}`, source: 'osdr', url: `${OSDR}/files/${n}`, save: `osdr/files-OSD-${n}.json` })),
  { id: 'OSDR study metadata, OSD-569', source: 'osdr', url: `${OSDR}/meta/569`, save: 'osdr/meta-OSD-569.json' },
  { id: 'OSDR biodata API, metadata query', source: 'osdr', url: 'https://visualization.osdr.nasa.gov/biodata/api/v2/query/metadata/?id.accession=OSD-569', save: 'osdr/biodata-metadata-OSD-569.txt' },
  { id: 'OSDR biodata API, dataset', source: 'osdr', url: 'https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/OSD-569/', save: 'osdr/biodata-dataset-OSD-569.json' },
  { id: 'MMASH landing page (PhysioNet)', source: 'mmash', url: 'https://physionet.org/content/mmash/1.0.0/', save: 'mmash/landing.html' },
  { id: 'MMASH file index (PhysioNet)', source: 'mmash', url: 'https://physionet.org/files/mmash/1.0.0/', save: 'mmash/file-index.html' },
  { id: 'MMASH on S3, unsigned listing', source: 'mmash', url: 'https://physionet-open.s3.amazonaws.com/?list-type=2&prefix=mmash/&max-keys=40', save: 'mmash/s3-listing.xml' },
  { id: 'NTRS citation search (POST)', source: 'ntrs', url: 'https://ntrs.nasa.gov/api/citations/search', method: 'POST', body: { q: 'carbon dioxide headache International Space Station', page: { size: 5, from: 0 } }, save: 'ntrs/search-co2-headache.json' },
];

/** One line describing what came back, so the report says more than "200". */
function describe(contentType, text) {
  if (/json/.test(contentType) || /^[[{]/.test(text.trimStart())) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) return `JSON array, ${data.length} items; keys: ${Object.keys(data[0] ?? {}).slice(0, 7).join(', ')}`;
      return `JSON object; keys: ${Object.keys(data).slice(0, 8).join(', ')}`;
    } catch {
      return 'looks like JSON but does not parse';
    }
  }
  if (/xml/.test(contentType)) return `XML, ${(text.match(/<Key>/g) ?? []).length} keys listed`;
  if (/html/.test(contentType)) return `HTML page, title: ${(text.match(/<title>([^<]*)/i)?.[1] ?? '?').trim().slice(0, 60)}`;
  return `${contentType || 'unknown type'}: ${text.slice(0, 60).replace(/\s+/g, ' ')}`;
}

const rateLimit = (headers) => {
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  return limit ? `${remaining}/${limit} remaining` : (headers.get('retry-after') ? `retry-after ${headers.get('retry-after')}` : 'none announced');
};

const results = [];
const manifest = [];
for (const endpoint of ENDPOINTS) {
  const started = performance.now();
  const row = { id: endpoint.id, source: endpoint.source, url: endpoint.url, ok: false, status: 0, ms: 0, bytes: 0, format: '', limit: '', error: '' };
  try {
    const response = await fetch(endpoint.url, {
      method: endpoint.method ?? 'GET',
      headers: { 'user-agent': 'health-monitoring-prototype/0.1', accept: '*/*', ...(endpoint.body ? { 'content-type': 'application/json' } : {}) },
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    const text = await response.text();
    row.status = response.status;
    row.ok = response.ok;
    row.bytes = Buffer.byteLength(text);
    row.format = describe(response.headers.get('content-type') ?? '', text);
    row.limit = rateLimit(response.headers);
    if (response.ok && endpoint.save) {
      const file = join(outDir, endpoint.save);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      manifest.push({
        file: endpoint.save,
        source: endpoint.source,
        url: endpoint.url.replace(/api_key=[^&]+/, 'api_key=***'),
        method: endpoint.method ?? 'GET',
        fetchedAt: new Date().toISOString(),
        bytes: row.bytes,
        sha256: createHash('sha256').update(text).digest('hex'),
      });
    }
  } catch (error) {
    row.error = String(error?.cause?.code ?? error?.name ?? error).slice(0, 80);
  }
  row.ms = Math.round(performance.now() - started);
  results.push(row);
  console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${String(row.status).padStart(3)} ${String(row.ms).padStart(6)} ms ${String(row.bytes).padStart(9)} B  ${row.id}\n       ${row.format || row.error}  | limit: ${row.limit || '-'}`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(outDir, 'smoke-report.json'), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} endpoints answered. Snapshots and manifest in ${outDir}`);
