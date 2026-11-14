// Builds the SQLite database from the rules matrix kept in git.
//
//   node tools/db/build.mjs <matrix dir> <migrations dir> <database file>
//
// The JSON files in the matrix directory are the source of truth; the database is derived
// and can be deleted and rebuilt at any time. Migrations are applied once, in order.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [matrixDir, migrationsDir, dbFile] = process.argv.slice(2);
if (!matrixDir || !migrationsDir || !dbFile) {
  console.error('Usage: node tools/db/build.mjs <matrix dir> <migrations dir> <database file>');
  process.exit(1);
}
const read = (name) => JSON.parse(readFileSync(join(matrixDir, name), 'utf8'));
const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));

mkdirSync(dirname(dbFile), { recursive: true });
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA foreign_keys = ON');
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');

const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) continue;
  db.exec('BEGIN');
  db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
  db.exec('COMMIT');
  console.log(`applied ${file}`);
}

// Sources come from the verification run when it exists, otherwise from the raw list.
const sources = existsSync(join(matrixDir, 'sources.resolved.json')) ? read('sources.resolved.json') : read('sources.json');
const verification = existsSync(join(matrixDir, 'verification.json')) ? read('verification.json') : {};
const evidence = read('evidence.json');
const rules = read('rules.json');

db.exec('BEGIN');
// Catalog rows are upserted; the two link tables are rebuilt. Run-time tables are left alone.
db.exec('DELETE FROM rule_evidence; DELETE FROM rule_treatments;');

const upsertSource = db.prepare(
  `INSERT INTO sources (id, title, publisher, url, doi, ntrs_id, matched_title, year, located, method, checked_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (id) DO UPDATE SET title = excluded.title, publisher = excluded.publisher, url = excluded.url, doi = excluded.doi,
     ntrs_id = excluded.ntrs_id, matched_title = excluded.matched_title, year = excluded.year, located = excluded.located,
     method = excluded.method, checked_at = excluded.checked_at`,
);
for (const s of sources) {
  upsertSource.run(s.id, s.title, s.publisher ?? null, s.url ?? null, s.doi ?? null, s.ntrsId ?? null, s.matchedTitle ?? null, s.year ?? null, s.located ? 1 : 0, s.method ?? null, s.checkedAt ?? null);
}

const upsertRule = db.prepare(
  `INSERT INTO rules (id, hazard, condition, hrr_risk, system_id, incidence, detect_kind, nasa_limit, detect_label, detect_criterion,
     detect_limits_json, efficacy, verify_criterion, verify_metrics_json, cautions_json, indicator_ids_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (id) DO UPDATE SET hazard = excluded.hazard, condition = excluded.condition, hrr_risk = excluded.hrr_risk,
     system_id = excluded.system_id, incidence = excluded.incidence, detect_kind = excluded.detect_kind, nasa_limit = excluded.nasa_limit,
     detect_label = excluded.detect_label, detect_criterion = excluded.detect_criterion, detect_limits_json = excluded.detect_limits_json,
     efficacy = excluded.efficacy, verify_criterion = excluded.verify_criterion, verify_metrics_json = excluded.verify_metrics_json,
     cautions_json = excluded.cautions_json, indicator_ids_json = excluded.indicator_ids_json`,
);
const insertTreatment = db.prepare('INSERT OR REPLACE INTO rule_treatments (rule_id, position, text, authority_level, requires_preauthorization) VALUES (?, ?, ?, ?, ?)');
for (const r of rules) {
  upsertRule.run(r.id, r.hazard, r.condition, r.hrrRisk ?? null, r.systemId ?? null, r.incidence ?? null, r.detect.kind, r.detect.nasaLimit ? 1 : 0, r.detect.label, r.detect.criterion, json(r.detect.limits), r.efficacy ?? null, r.verify.criterion, json(r.verify.metrics), json(r.cautions), json(r.indicatorIds));
  r.treat.forEach((step, i) => insertTreatment.run(r.id, i + 1, step.text, step.authorityLevel, step.requiresPreauthorization ? 1 : 0));
}

const upsertEvidence = db.prepare(
  `INSERT OR REPLACE INTO evidence (id, provenance_class, claim, n, n_note, effect, effect_value, ci95_low, ci95_high, p, source_id, limitations, report_markers, verification_status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const linkEvidence = db.prepare('INSERT OR IGNORE INTO rule_evidence (rule_id, evidence_id) VALUES (?, ?)');
for (const e of evidence) {
  upsertEvidence.run(e.id, e.provenanceClass, e.claim, e.n ?? null, e.nNote ?? null, e.effect, e.effectValue ?? null, e.ci95?.[0] ?? null, e.ci95?.[1] ?? null, e.p ?? null, e.sourceId, e.limitations ?? null, (e.reportMarkers ?? []).join(' '), verification[e.id]?.status ?? 'sin_verificar');
}
for (const r of rules) for (const id of r.evidenceIds) linkEvidence.run(r.id, id);
db.exec('COMMIT');

const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
console.log(`${dbFile}: ${count('rules')} rules, ${count('rule_treatments')} treatment steps, ${count('evidence')} evidence rows, ${count('sources')} sources`);
for (const row of db.prepare('SELECT provenance_class, COUNT(*) AS c FROM evidence GROUP BY provenance_class ORDER BY c DESC').all()) {
  console.log(`  ${String(row.c).padStart(3)}  ${row.provenance_class}`);
}
db.close();
