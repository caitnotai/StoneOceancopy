import type { HazardId, IndicatorId, SystemId } from '../types';

/**
 * Where a piece of evidence comes from. Each class deserves a different level of
 * confidence, autonomy and escalation, so they are never pooled together.
 * The keys are the project's agreed vocabulary and are stored as written.
 */
export const PROVENANCE_CLASSES = [
  'observado_en_vuelo',
  'analogo_terrestre',
  'IMM_simulado',
  'modelo_radiacion',
  'estandar_obligatorio',
  'criterio_clinico_NASA',
  'hipotesis_gap_HRR',
] as const;
export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

export const PROVENANCE_LABEL: Record<ProvenanceClass, string> = {
  observado_en_vuelo: 'Observed in flight',
  analogo_terrestre: 'Ground analog',
  IMM_simulado: 'Simulated (Integrated Medical Model)',
  modelo_radiacion: 'Radiation model',
  estandar_obligatorio: 'Mandatory standard',
  criterio_clinico_NASA: 'NASA clinical criterion',
  hipotesis_gap_HRR: 'Open research gap (hypothesis)',
};

/** How an alert is derived. Only the first two are NASA limits. */
export const DETECT_KINDS = ['estandar_obligatorio', 'criterio_clinico_NASA', 'baseline_individual', 'limite_de_programa'] as const;
export type DetectKind = (typeof DETECT_KINDS)[number];

export const VERIFICATION_STATUSES = ['verificado', 'fuente_localizada', 'sin_verificar'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verificado: 'Figure confirmed in the source abstract',
  fuente_localizada: 'Source located; figure not yet confirmed',
  sin_verificar: 'Source not verified',
};

/**
 * Who may act. Taken from the research report: the software never turns research
 * evidence into an autonomous prescription.
 */
export type AuthorityLevel = 1 | 2 | 3 | 4;

export const AUTHORITY_LABEL: Record<AuthorityLevel, string> = {
  1: 'Level 1 · reversible environmental action',
  2: 'Level 2 · pre-approved non-drug countermeasure',
  3: 'Level 3 · drug prescribed in the mission medical plan',
  4: 'Level 4 · emergency protocol and medical link',
};

export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string | null;
  doi: string | null;
  ntrsId: string | null;
  matchedTitle: string | null;
  year: string | null;
  located: boolean;
  method: string | null;
  checkedAt: string | null;
}

export interface Evidence {
  id: string;
  ruleIds: string[];
  provenanceClass: ProvenanceClass;
  claim: string;
  /** Sample size; null when the report does not state one. */
  n: number | null;
  nNote?: string;
  /** Effect size as reported. */
  effect: string;
  effectValue?: number;
  ci95: [number, number] | null;
  p: string | null;
  sourceId: string;
  reportMarkers: string[];
  limitations: string;
}

export interface TreatmentStep {
  text: string;
  authorityLevel: AuthorityLevel;
  /** True for anything pharmacological: hidden unless the medical plan pre-authorizes it. */
  requiresPreauthorization: boolean;
}

export interface RuleDetect {
  kind: DetectKind;
  /** True only for a NASA standard or NASA clinical criterion. */
  nasaLimit: boolean;
  label: string;
  criterion: string;
  limits?: { metric: string; caution?: number; critical?: number };
}

/** One row of the Detect -> Treat -> Verify matrix. */
export interface Rule {
  id: string;
  /** Set to 'project' for rules added by this project; absent for the rows of the research report. */
  origin?: 'project';
  hazard: HazardId;
  condition: string;
  hrrRisk: string;
  /** Body system the rule belongs to; null for whole-crew rules. */
  systemId: SystemId | null;
  indicatorIds: IndicatorId[];
  incidence: string;
  detect: RuleDetect;
  treat: TreatmentStep[];
  cautions: string[];
  efficacy: string;
  verify: { criterion: string; metrics: string[] };
  evidenceIds: string[];
}

export interface EvidenceWithSource extends Evidence {
  source: Source;
  verification: VerificationStatus;
}
