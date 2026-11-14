/** A flux measurement: `t` in any consistent time unit, `value` in pfu. */
export interface FluxPoint {
  t: number;
  value: number;
}

/**
 * NOAA Space Weather Scale for solar radiation storms: level S1 to S5 by the flux of
 * protons at 10 MeV or more, in particle flux units (pfu). Thresholds as published by
 * NOAA SWPC (snapshot in data/snapshots/swpc/noaa-scales-explanation.html).
 * It is an operational scale, not a NASA medical limit.
 */
export const S_SCALE_PFU = [10, 100, 1_000, 10_000, 100_000] as const;
export const S_SCALE_NAME = ['none', 'minor', 'moderate', 'strong', 'severe', 'extreme'] as const;

/** 0 for no storm, 1 to 5 for S1 to S5. */
export function sScale(fluxPfu: number): 0 | 1 | 2 | 3 | 4 | 5 {
  let level = 0;
  for (const threshold of S_SCALE_PFU) if (fluxPfu >= threshold) level += 1;
  return level as 0 | 1 | 2 | 3 | 4 | 5;
}

export interface SpeState {
  /** True when the flux has stayed at S1 or above for the required number of readings. */
  inProgress: boolean;
  level: 0 | 1 | 2 | 3 | 4 | 5;
  peakPfu: number;
  /** Mission time when the event started, or null. */
  startedAt: number | null;
}

/**
 * Detects a solar particle event from a series of >=10 MeV proton flux readings. One
 * reading above threshold can be a glitch, so the event needs `sustain` consecutive
 * readings at S1 or above; the level reported is the highest reached since it started.
 */
export function detectSpe(readings: readonly FluxPoint[], sustain = 3): SpeState {
  let run = 0;
  let startedAt: number | null = null;
  let peak = 0;
  for (const r of readings) {
    if (r.value >= S_SCALE_PFU[0]) {
      if (run === 0) {
        startedAt = r.t;
        peak = 0;
      }
      run += 1;
      peak = Math.max(peak, r.value);
    } else {
      run = 0;
      startedAt = null;
      peak = 0;
    }
  }
  const inProgress = run >= sustain;
  return { inProgress, level: inProgress ? sScale(peak) : 0, peakPfu: inProgress ? peak : 0, startedAt: inProgress ? startedAt : null };
}
