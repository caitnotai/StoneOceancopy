import snapshotJson from '../../data/snapshots/space-weather.json';
import { parseGoesProtons, radiationNow, type FluxSample, type RadiationNow, type SepEvent } from '../domain/radiation/spaceWeather';

const LIVE_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json';
const LIVE_TIMEOUT_MS = 6_000;

interface Snapshot {
  goes: { satellite: number | null; fetchedAt: string | null; flux: [number, number][] };
  donki: { fetchedAt: string | null; from: string | null; to: string | null; events: SepEvent[] };
}
const SNAPSHOT = snapshotJson as unknown as Snapshot;

/** Real space weather, either fetched just now or from the snapshot bundled with the app. */
export interface SpaceWeather {
  origin: 'live' | 'snapshot';
  satellite: number | null;
  samples: FluxSample[];
  now: RadiationNow;
  /** Solar energetic particle events on record (always from the bundled DONKI snapshot). */
  events: SepEvent[];
  eventsFrom: string | null;
  eventsTo: string | null;
}

const withEvents = (origin: SpaceWeather['origin'], satellite: number | null, samples: FluxSample[]): SpaceWeather => ({
  origin,
  satellite,
  samples,
  now: radiationNow(samples),
  events: SNAPSHOT.donki.events,
  eventsFrom: SNAPSHOT.donki.from,
  eventsTo: SNAPSHOT.donki.to,
});

/** Offline-first: this never touches the network. */
export function snapshotSpaceWeather(): SpaceWeather {
  return withEvents('snapshot', SNAPSHOT.goes.satellite, SNAPSHOT.goes.flux.map(([t, value]) => ({ t, value })));
}

/**
 * Tries the live NOAA feed and falls back to the bundled snapshot on any failure, so the
 * app behaves the same with or without a connection. `fetchImpl` is injectable for tests.
 */
export async function loadSpaceWeather(fetchImpl: typeof fetch = fetch): Promise<SpaceWeather> {
  try {
    const response = await fetchImpl(LIVE_URL, { signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const records = (await response.json()) as { satellite?: number }[];
    const samples = parseGoesProtons(records);
    if (samples.length === 0) throw new Error('no >=10 MeV readings in the response');
    return withEvents('live', records[0]?.satellite ?? null, samples);
  } catch {
    return snapshotSpaceWeather();
  }
}
