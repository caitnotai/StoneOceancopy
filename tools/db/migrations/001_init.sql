-- 001: rules matrix with evidence provenance, plus the run-time tables of the
-- Detect -> Treat -> Verify loop. Additive migrations only: never edit this file once
-- applied; add 002_*.sql instead.

CREATE TABLE sources (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  publisher     TEXT,
  url           TEXT,
  doi           TEXT,
  ntrs_id       TEXT,
  matched_title TEXT,
  year          TEXT,
  located       INTEGER NOT NULL DEFAULT 0,
  method        TEXT,
  checked_at    TEXT
);

CREATE TABLE rules (
  id                  TEXT PRIMARY KEY,
  hazard              TEXT NOT NULL CHECK (hazard IN ('radiation', 'isolation', 'distance', 'gravity', 'environment')),
  condition           TEXT NOT NULL,
  hrr_risk            TEXT,
  system_id           TEXT,
  incidence           TEXT,
  -- How the alert is derived. Only the first two are NASA limits.
  detect_kind         TEXT NOT NULL CHECK (detect_kind IN ('estandar_obligatorio', 'criterio_clinico_NASA', 'baseline_individual', 'limite_de_programa')),
  nasa_limit          INTEGER NOT NULL CHECK (nasa_limit IN (0, 1)),
  detect_label        TEXT NOT NULL,
  detect_criterion    TEXT NOT NULL,
  detect_limits_json  TEXT,
  efficacy            TEXT,
  verify_criterion    TEXT NOT NULL,
  verify_metrics_json TEXT,
  cautions_json       TEXT,
  indicator_ids_json  TEXT,
  -- A rule may only claim a NASA limit when it is a standard or a NASA clinical criterion.
  CHECK (nasa_limit = 0 OR detect_kind IN ('estandar_obligatorio', 'criterio_clinico_NASA'))
);

CREATE TABLE rule_treatments (
  rule_id                   TEXT NOT NULL REFERENCES rules (id),
  position                  INTEGER NOT NULL,
  text                      TEXT NOT NULL,
  -- 1 reversible environmental action, 2 pre-approved non-drug countermeasure,
  -- 3 drug prescribed in the mission medical plan, 4 emergency protocol.
  authority_level           INTEGER NOT NULL CHECK (authority_level BETWEEN 1 AND 4),
  requires_preauthorization INTEGER NOT NULL CHECK (requires_preauthorization IN (0, 1)),
  PRIMARY KEY (rule_id, position),
  -- Level 3 is drugs: it always needs the pre-authorization flag.
  CHECK (authority_level <> 3 OR requires_preauthorization = 1)
);

CREATE TABLE evidence (
  id                  TEXT PRIMARY KEY,
  provenance_class    TEXT NOT NULL CHECK (provenance_class IN (
                        'observado_en_vuelo', 'analogo_terrestre', 'IMM_simulado', 'modelo_radiacion',
                        'estandar_obligatorio', 'criterio_clinico_NASA', 'hipotesis_gap_HRR')),
  claim               TEXT NOT NULL,
  n                   INTEGER,
  n_note              TEXT,
  effect              TEXT NOT NULL,
  effect_value        REAL,
  ci95_low            REAL,
  ci95_high           REAL,
  p                   TEXT,
  source_id           TEXT NOT NULL REFERENCES sources (id),
  limitations         TEXT,
  report_markers      TEXT,
  verification_status TEXT NOT NULL DEFAULT 'sin_verificar' CHECK (verification_status IN ('verificado', 'fuente_localizada', 'sin_verificar'))
);

CREATE TABLE rule_evidence (
  rule_id     TEXT NOT NULL REFERENCES rules (id),
  evidence_id TEXT NOT NULL REFERENCES evidence (id),
  PRIMARY KEY (rule_id, evidence_id)
);

-- Run-time tables ---------------------------------------------------------------

CREATE TABLE measurements (
  id            INTEGER PRIMARY KEY,
  crew_id       TEXT NOT NULL,
  indicator_id  TEXT NOT NULL,
  value         REAL NOT NULL,
  t_mission_min REAL NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('simulated', 'manual', 'sensor'))
);
CREATE INDEX measurements_series ON measurements (crew_id, indicator_id, t_mission_min);

CREATE TABLE baselines (
  crew_id      TEXT NOT NULL,
  indicator_id TEXT NOT NULL,
  mean         REAL NOT NULL,
  sd           REAL NOT NULL,
  n            INTEGER NOT NULL,
  method       TEXT NOT NULL,
  prior_mean   REAL,
  prior_sd     REAL,
  updated_at_min REAL,
  PRIMARY KEY (crew_id, indicator_id)
);

-- No alert without provenance and a source: enforced by NOT NULL and the foreign key.
CREATE TABLE alerts (
  id               INTEGER PRIMARY KEY,
  crew_id          TEXT NOT NULL,
  rule_id          TEXT NOT NULL REFERENCES rules (id),
  indicator_id     TEXT,
  status           TEXT NOT NULL CHECK (status IN ('caution', 'critical')),
  detect_kind      TEXT NOT NULL,
  provenance_class TEXT NOT NULL,
  source_id        TEXT NOT NULL REFERENCES sources (id),
  value            REAL,
  detail           TEXT,
  raised_at_min    REAL NOT NULL,
  closed_at_min    REAL
);

CREATE TABLE interventions (
  id              INTEGER PRIMARY KEY,
  alert_id        INTEGER NOT NULL REFERENCES alerts (id),
  rule_id         TEXT NOT NULL REFERENCES rules (id),
  step_text       TEXT NOT NULL,
  authority_level INTEGER NOT NULL CHECK (authority_level BETWEEN 1 AND 4),
  preauthorized   INTEGER NOT NULL DEFAULT 0 CHECK (preauthorized IN (0, 1)),
  started_at_min  REAL NOT NULL
);

-- An intervention is closed by a measured response, never by having been carried out.
CREATE TABLE verifications (
  id              INTEGER PRIMARY KEY,
  intervention_id INTEGER NOT NULL REFERENCES interventions (id),
  metric          TEXT NOT NULL,
  value_before    REAL,
  value_after     REAL,
  outcome         TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'verified', 'not_verified')),
  checked_at_min  REAL
);
