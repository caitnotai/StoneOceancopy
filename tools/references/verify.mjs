// Re-links every claim of the rules matrix to a source that can actually be opened.
//
//   node tools/references/verify.mjs <matrix dir> <reference_map.csv>
//
// The research report cites its sources with markers that do not resolve. This script
// looks each source up again (NASA NTRS, Crossref for DOIs, or a plain URL check) and then
// checks whether the key figures of each claim appear in the abstract of the source found.
//
// Status written per claim:
//   verificado         source located AND every key figure appears in its abstract
//   fuente_localizada  source located, figures not confirmed (they may be in the full text)
//   sin_verificar      no source could be located
//
// Data provided by NASA STI Program (NTRS) and Crossref.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [matrixDir, csvFile] = process.argv.slice(2);
if (!matrixDir || !csvFile) {
  console.error('Usage: node tools/references/verify.mjs <matrix dir> <reference_map.csv>');
  process.exit(1);
}
const read = (name) => JSON.parse(readFileSync(join(matrixDir, name), 'utf8'));
const sources = read('sources.json');
const evidence = read('evidence.json');
const HEADERS = { 'user-agent': 'health-monitoring-prototype/0.1', accept: 'application/json' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Results of the previous run. A source that was located before and does not answer today
// (a network hiccup, a rate limit) keeps its earlier result instead of being downgraded.
const previousSources = existsSync(join(matrixDir, 'sources.resolved.json')) ? read('sources.resolved.json') : [];
const previousStatus = existsSync(join(matrixDir, 'verification.json')) ? read('verification.json') : {};

async function fromNtrs({ query, titleMatch, abstractMatch }) {
  const response = await fetch('https://ntrs.nasa.gov/api/citations/search', {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, page: { size: 20, from: 0 } }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) return null;
  const pattern = new RegExp(titleMatch, 'i');
  const titled = ((await response.json()).results ?? []).filter((r) => pattern.test(r.title ?? ''));
  // When several records fit the title, prefer the one whose abstract carries the figure.
  const inAbstract = abstractMatch ? titled.find((r) => new RegExp(abstractMatch, 'i').test(r.abstract ?? '')) : null;
  const hit = inAbstract ?? titled[0];
  if (!hit) return null;
  return {
    method: 'NTRS search',
    url: `https://ntrs.nasa.gov/citations/${hit.id}`,
    ntrsId: String(hit.id),
    doi: null,
    matchedTitle: (hit.title ?? '').replace(/\s+/g, ' ').trim(),
    year: (hit.publications?.[0]?.publicationDate ?? hit.created ?? '').slice(0, 4),
    abstract: hit.abstract ?? '',
  };
}

async function fromCrossref({ query, titleMatch }) {
  const url = `https://api.crossref.org/works?rows=8&select=DOI,title,issued,abstract,container-title&query.bibliographic=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(40_000) });
  if (!response.ok) return null;
  const pattern = new RegExp(titleMatch, 'i');
  const hit = (await response.json()).message?.items?.find((item) => pattern.test(item.title?.[0] ?? ''));
  if (!hit) return null;
  return {
    method: 'Crossref',
    url: `https://doi.org/${hit.DOI}`,
    ntrsId: null,
    doi: hit.DOI,
    matchedTitle: `${hit.title[0]} (${hit['container-title']?.[0] ?? 'journal'})`,
    year: String(hit.issued?.['date-parts']?.[0]?.[0] ?? ''),
    abstract: (hit.abstract ?? '').replace(/<[^>]+>/g, ' '),
  };
}

/** A DOI is only accepted if Crossref resolves it to a title that matches. */
async function fromDoi({ doi, titleMatch }) {
  const response = await fetch(`https://api.crossref.org/works/${doi}`, { headers: HEADERS, signal: AbortSignal.timeout(40_000) });
  if (!response.ok) return null;
  const work = (await response.json()).message;
  const title = work?.title?.[0] ?? '';
  if (!new RegExp(titleMatch, 'i').test(title)) return null;
  return {
    method: 'DOI resolved by Crossref',
    url: `https://doi.org/${work.DOI}`,
    ntrsId: null,
    doi: work.DOI,
    matchedTitle: `${title} (${(work['container-title']?.[0] ?? 'journal').replace(/&amp;/g, '&')})`,
    year: String(work.issued?.['date-parts']?.[0]?.[0] ?? ''),
    abstract: (work.abstract ?? '').replace(/<[^>]+>/g, ' '),
  };
}

async function fromUrl({ url }) {
  const response = await fetch(url, { headers: { ...HEADERS, accept: '*/*' }, signal: AbortSignal.timeout(40_000) });
  if (!response.ok) return null;
  const text = await response.text();
  return {
    method: 'URL responds',
    url,
    ntrsId: null,
    doi: null,
    matchedTitle: (text.match(/<title>([^<]*)/i)?.[1] ?? '').trim().slice(0, 140),
    year: '',
    abstract: '',
  };
}

const LOOKUP = { ntrs: fromNtrs, crossref: fromCrossref, doi: fromDoi, url: fromUrl };

const located = new Map();
for (const source of sources) {
  let found = null;
  for (const candidate of source.candidates) {
    try {
      found = await LOOKUP[candidate.kind](candidate);
      // Any of these services occasionally drops a request: one retry before giving up.
      if (!found) {
        await sleep(1500);
        found = await LOOKUP[candidate.kind](candidate);
      }
    } catch (error) {
      console.warn(`  ${source.id}: ${candidate.kind} lookup failed (${error?.cause?.code ?? error?.name})`);
    }
    await sleep(350);
    if (found) break;
  }
  const earlier = previousSources.find((s) => s.id === source.id && s.located);
  if (!found && earlier) {
    found = { method: earlier.method, url: earlier.url, ntrsId: earlier.ntrsId, doi: earlier.doi, matchedTitle: earlier.matchedTitle, year: earlier.year ?? '', abstract: '', kept: true };
  }
  located.set(source.id, found);
  console.log(`${found ? 'found  ' : 'MISSING'} ${source.id.padEnd(22)} ${found ? `${found.method}: ${found.matchedTitle.slice(0, 80)}` : ''}`);
}

const checkedAt = new Date().toISOString().slice(0, 10);
const rows = evidence.map((item) => {
  const source = sources.find((s) => s.id === item.sourceId);
  const found = located.get(item.sourceId);
  const terms = item.checkTerms ?? [];
  const haystack = (found?.abstract ?? '').replace(/\s+/g, ' ');
  const matched = terms.filter((term) => haystack.includes(term));
  let status = !found ? 'sin_verificar' : terms.length > 0 && matched.length === terms.length ? 'verificado' : 'fuente_localizada';
  // Without today's abstract the figures cannot be re-checked: keep what the last run found.
  if (found?.kept && previousStatus[item.id]?.status) status = previousStatus[item.id].status;
  const note = !found
    ? 'No source located automatically; needs a manual search.'
    : status === 'verificado'
      ? `All key figures found in the abstract: ${matched.join(', ')}.`
      : terms.length === 0
        ? 'Source located; this claim has no single figure to check.'
        : `Source located; figures not in the abstract (${terms.filter((t) => !matched.includes(t)).join(', ')}). Check the full text.`;
  return {
    evidence_id: item.id,
    rule_ids: item.ruleIds.join(' '),
    claim: item.claim,
    provenance_class: item.provenanceClass,
    report_markers: (item.reportMarkers ?? []).join(' '),
    source_id: item.sourceId,
    source_title: found?.matchedTitle ?? source?.title ?? '',
    url: found?.url ?? '',
    doi: found?.doi ?? '',
    ntrs_id: found?.ntrsId ?? '',
    status,
    method: found?.method ?? '',
    checked_at: checkedAt,
    note,
  };
});

const columns = Object.keys(rows[0]);
const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
writeFileSync(csvFile, [columns.join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join('\n') + '\n');

// Per-claim verification, for the app and the database.
writeFileSync(
  join(matrixDir, 'verification.json'),
  JSON.stringify(Object.fromEntries(rows.map((r) => [r.evidence_id, { status: r.status, method: r.method, checkedAt: r.checked_at, note: r.note }])), null, 2) + '\n',
);

// The located sources are also written back for the app and the database to use.
const resolved = sources.map(({ candidates, ...source }) => {
  const found = located.get(source.id);
  return { ...source, url: found?.url ?? null, doi: found?.doi ?? null, ntrsId: found?.ntrsId ?? null, matchedTitle: found?.matchedTitle ?? null, year: found?.year ?? null, located: Boolean(found), method: found?.method ?? null, checkedAt };
});
writeFileSync(join(matrixDir, 'sources.resolved.json'), JSON.stringify(resolved, null, 2) + '\n');

const count = (status) => rows.filter((r) => r.status === status).length;
console.log(`\n${rows.length} claims: ${count('verificado')} verificado, ${count('fuente_localizada')} fuente_localizada, ${count('sin_verificar')} sin_verificar`);
console.log(`${[...located.values()].filter(Boolean).length}/${sources.length} sources located -> ${csvFile}`);
