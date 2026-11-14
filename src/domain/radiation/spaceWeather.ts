import { detectSpe, S_SCALE_NAME, S_SCALE_PFU, sScale, type FluxPoint, type SpeState } from './spe';

/** Proton flux at 10 MeV or more. `t` is milliseconds since the Unix epoch (UTC). */
export type FluxSample = FluxPoint;

const ENERGY = '>=10 MeV';
const DAY_MS = 86_400_000;

/**
 * Reads the NOAA SWPC GOES integral proton product
 * (services.swpc.noaa.gov/json/goes/primary/integral-protons-*.json) and keeps the
 * channel the NOAA S-scale is defined on. Tolerant of missing or malformed records.
 */
export function parseGoesProtons(records: unknown): FluxSample[] {
  if (!Array.isArray(records)) return [];
  const samples: FluxSample[] = [];
  for (const record of records as Record<string, unknown>[]) {
    if (record?.energy !== ENERGY) continue;
    const t = Date.parse(String(record.time_tag));
    const value = Number(record.flux);
    if (Number.isFinite(t) && Number.isFinite(value) && value >= 0) samples.push({ t, value });
  }
  return samples.sort((a, b) => a.t - b.t);
}

/** What the crew needs to know about solar radiation right now. */
export interface RadiationNow {
  latest: FluxSample | null;
  /** NOAA S-scale level of the latest reading: 0 (none) to 5 (extreme). */
  level: 0 | 1 | 2 | 3 | 4 | 5;
  levelName: string;
  /** Event in progress, judged on the last 24 hours of readings. */
  event: SpeState;
  /** Highest flux in the series, for context. */
  peak: FluxSample | null;
  /** Flux at which level S1 starts, in pfu. */
  s1Threshold: number;
}

/** The answer to "/radiation/now": current level and whether an event is in progress. */
export function radiationNow(samples: readonly FluxSample[]): RadiationNow {
  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  const level = latest ? sScale(latest.value) : 0;
  const lastDay = latest ? samples.filter((s) => s.t > latest.t - DAY_MS) : [];
  const peak = samples.reduce<FluxSample | null>((best, s) => (!best || s.value > best.value ? s : best), null);
  return { latest, level, levelName: S_SCALE_NAME[level], event: detectSpe(lastDay), peak, s1Threshold: S_SCALE_PFU[0] };
}

/** A solar energetic particle event listed by NASA DONKI. */
export interface SepEvent {
  id: string;
  time: string;
  instruments: string[];
  link: string;
}
