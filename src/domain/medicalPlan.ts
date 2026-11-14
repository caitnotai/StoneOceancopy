/**
 * The mission medical plan, as far as this software needs it.
 *
 * Decision support, not diagnosis: the software never turns evidence into a prescription.
 * Any drug step stays hidden unless the plan says drugs are pre-authorized, and that flag
 * is off by default.
 */
export interface MedicalPlan {
  drugsPreauthorized: boolean;
}

export const DEFAULT_MEDICAL_PLAN: MedicalPlan = { drugsPreauthorized: false };

const PHARMACOLOGICAL = /medication|fever reducer|supplemental oxygen|analges|antiviral|bisphosphonate|radioprotect|\bdrugs?\b/i;

/** True for any step that involves a drug or medical gas. */
export const isPharmacological = (stepText: string): boolean => PHARMACOLOGICAL.test(stepText);

export const WITHHELD_STEP = 'Medication step withheld: it needs a pre-authorized mission medical plan.';

export interface OfferedStep {
  text: string;
  /** True when the real step is a drug step and the plan does not pre-authorize drugs. */
  withheld: boolean;
  pharmacological: boolean;
}

/** Applies the medical plan to a list of steps: drug steps are replaced unless pre-authorized. */
export function offerSteps(steps: readonly string[], plan: MedicalPlan): OfferedStep[] {
  return steps.map((text) => {
    const pharmacological = isPharmacological(text);
    const withheld = pharmacological && !plan.drugsPreauthorized;
    return { text: withheld ? WITHHELD_STEP : text, withheld, pharmacological };
  });
}
