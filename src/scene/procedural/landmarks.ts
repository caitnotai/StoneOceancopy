import { v } from './geometry';

/**
 * Shared anatomical landmarks (left side of the body = +x; the body faces +z).
 * Every part builder positions itself from these, so proportions stay consistent
 * and changing the figure means editing one file.
 */
export const LM = {
  headCenter: v(0, 1.635, 0.005),
  headRadii: v(0.1, 0.122, 0.112),
  neckTop: v(0, 1.535, -0.005),
  neckBase: v(0, 1.445, -0.012),
  chest: v(0, 1.3, 0),
  pelvis: v(0, 0.94, -0.005),
  shoulder: v(0.2, 1.405, -0.008),
  elbow: v(0.262, 1.125, -0.02),
  wrist: v(0.305, 0.875, 0.035),
  handTip: v(0.324, 0.762, 0.062),
  hip: v(0.092, 0.905, 0),
  knee: v(0.1, 0.5, 0.012),
  ankle: v(0.105, 0.085, -0.012),
  heel: v(0.105, 0.036, -0.045),
  toe: v(0.12, 0.03, 0.135),
} as const;
