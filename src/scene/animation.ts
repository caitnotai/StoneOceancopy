import type { Vitals } from './BodyModel';

/** Two quick bumps per cycle, like the "lub-dub" of a real heartbeat. `phase` is 0..1. */
function heartbeat(phase: number): number {
  const bump = (center: number, width: number): number => Math.exp(-((phase - center) ** 2) / (2 * width * width));
  return bump(0.12, 0.045) + 0.55 * bump(0.32, 0.05);
}

/** Scale of the heart at a moment in time: it beats at the crew member's actual heart rate. */
export function heartScale(elapsed: number, vitals: Vitals): number {
  const phase = (elapsed * vitals.heartRateBpm) / 60;
  return 1 + 0.09 * heartbeat(phase - Math.floor(phase));
}

/** -1..1 breathing cycle. */
export function breath(elapsed: number, vitals: Vitals): number {
  return Math.sin((elapsed * vitals.breathsPerMinute * 2 * Math.PI) / 60);
}
