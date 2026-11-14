import type { IndicatorId } from '../types';
import { primaryEvidence, ruleById, SOURCES } from './catalog';
import type { EvidenceWithSource, Rule, Source } from './types';

/**
 * Where the alert threshold of an indicator comes from.
 * Only the first two are NASA limits; the dashboard says so next to every alert.
 */
export const THRESHOLD_BASES = [
  'estandar_obligatorio',
  'criterio_clinico_NASA',
  'baseline_individual',
  'limite_de_programa',
  'escala_operacional',
  'rango_ilustrativo',
] as const;
export type ThresholdBasis = (typeof THRESHOLD_BASES)[number];

export const BASIS_LABEL: Record<ThresholdBasis, string> = {
  estandar_obligatorio: 'NASA standard',
  criterio_clinico_NASA: 'NASA clinical criterion',
  baseline_individual: 'Individual baseline · not a NASA limit',
  limite_de_programa: 'Mission budget set by the program · not a NASA limit',
  escala_operacional: 'NOAA operational scale · not a NASA limit',
  rango_ilustrativo: 'Illustrative terrestrial range · not a NASA limit',
};

export const isNasaLimit = (basis: ThresholdBasis): boolean =>
  basis === 'estandar_obligatorio' || basis === 'criterio_clinico_NASA';

interface IndicatorRule {
  /** Row of the Detect -> Treat -> Verify matrix this indicator belongs to. */
  ruleId: string;
  /** Basis of the threshold in use today. */
  basis: ThresholdBasis;
  /** Source of the threshold itself when it is not the rule's own evidence. */
  basisSourceId?: string;
}

/**
 * Indicator -> rule. Kept apart from the indicator catalog so that catalog keeps its shape.
 *
 * Where NASA publishes no limit, the rule calls for the individual baseline. The basis
 * recorded here is the fallback used until the person has a baseline (14 recorded days):
 * the illustrative terrestrial range, labeled as such. Once the baseline exists,
 * `provenanceOf(id, true)` reports `baseline_individual` instead.
 */
export const INDICATOR_RULES: Record<IndicatorId, IndicatorRule> = {
  ppCO2: { ruleId: 'R-CO2', basis: 'estandar_obligatorio' },
  retinalThickness: { ruleId: 'R-SANS', basis: 'criterio_clinico_NASA' },
  visionChange: { ruleId: 'R-SANS', basis: 'rango_ilustrativo' },
  protonFlux: { ruleId: 'R-RADIATION', basis: 'escala_operacional', basisSourceId: 'S-NOAA-SCALES' },
  radiationDose: { ruleId: 'R-RADIATION', basis: 'limite_de_programa' },
  heartRate: { ruleId: 'R-ORTHO', basis: 'rango_ilustrativo' },
  systolicBP: { ruleId: 'R-ORTHO', basis: 'rango_ilustrativo' },
  resistiveExercise: { ruleId: 'R-BONE', basis: 'rango_ilustrativo' },
  aerobicExercise: { ruleId: 'R-MUSCLE', basis: 'rango_ilustrativo' },
  sleepHours: { ruleId: 'R-SLEEP', basis: 'rango_ilustrativo' },
  mood: { ruleId: 'R-SLEEP', basis: 'rango_ilustrativo' },
  bodyTemp: { ruleId: 'R-IMMUNE', basis: 'rango_ilustrativo' },
  spo2: { ruleId: 'R-MINOR', basis: 'rango_ilustrativo' },
  dizziness: { ruleId: 'R-MEDICAL', basis: 'rango_ilustrativo' },
  glucose: { ruleId: 'R-NUTRITION', basis: 'rango_ilustrativo' },
  calorieIntake: { ruleId: 'R-NUTRITION', basis: 'rango_ilustrativo' },
};

/** Everything an alert must show about where it comes from. */
export interface AlertProvenance {
  indicatorId: IndicatorId;
  rule: Rule;
  basis: ThresholdBasis;
  basisLabel: string;
  nasaLimit: boolean;
  /** Evidence behind the rule; carries the provenance class. */
  evidence: EvidenceWithSource;
  /** Source of the threshold in use. */
  source: Source;
}

/**
 * Provenance of the alert an indicator can raise. Throws if the data is incomplete.
 * @param againstBaseline true when the indicator is being judged against the individual baseline
 */
export function provenanceOf(indicatorId: IndicatorId, againstBaseline = false): AlertProvenance {
  const link = againstBaseline ? { ...INDICATOR_RULES[indicatorId], basis: 'baseline_individual' as const } : INDICATOR_RULES[indicatorId];
  const rule = ruleById(link.ruleId);
  const evidence = rule ? primaryEvidence(rule) : undefined;
  if (!rule || !evidence) throw new Error(`Indicator ${indicatorId} has no rule with evidence (${link.ruleId})`);
  const source = (link.basisSourceId ? SOURCES.find((s) => s.id === link.basisSourceId) : undefined) ?? evidence.source;
  return { indicatorId, rule, basis: link.basis, basisLabel: BASIS_LABEL[link.basis], nasaLimit: isNasaLimit(link.basis), evidence, source };
}
