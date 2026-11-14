import { describe, expect, it } from 'vitest';
import rawGoesJson from '../data/snapshots/swpc/integral-protons-7-day.json';
import { HealthStore } from '../src/data/HealthStore';
import { MissionClock } from '../src/data/MissionClock';
import { SimulatedSource } from '../src/data/sources/SimulatedSource';
import { loadSpaceWeather, snapshotSpaceWeather } from '../src/data/spaceWeather';
import { parseGoesProtons, radiationNow, type FluxSample } from '../src/domain/radiation/spaceWeather';

const rawGoes = rawGoesJson as unknown as Record<string, unknown>[];
const MIN = 60_000;
const series = (values: number[], start = Date.UTC(2026, 10, 14)): FluxSample[] => values.map((value, i) => ({ t: start + i * 5 * MIN, value }));
const answer = (body: unknown, ok = true, status = 200) => (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;

describe('GOES proton feed (NOAA SWPC)', () => {
  it('keeps only the >=10 MeV channel of the real snapshot, in time order', () => {
    const samples = parseGoesProtons(rawGoes);
    expect(samples.length).toBe(rawGoes.filter((r) => r.energy === '>=10 MeV').length);
    expect(samples.length).toBeGreaterThan(1500);
    expect(samples.every((s, i) => i === 0 || s.t >= samples[i - 1].t)).toBe(true);
    expect(samples.every((s) => s.value >= 0)).toBe(true);
  });

  it('survives responses that are not what it expects', () => {
    expect(parseGoesProtons(null)).toEqual([]);
    expect(parseGoesProtons({ error: 'down' })).toEqual([]);
    expect(parseGoesProtons([{ energy: '>=10 MeV', time_tag: 'not a date', flux: 1 }, { energy: '>=10 MeV', time_tag: '2026-11-14T00:00:00Z', flux: 'x' }, { time_tag: '2026-11-14T00:00:00Z', flux: 1 }])).toEqual([]);
  });
});

describe('radiation now', () => {
  it('reads the real snapshot as a quiet sun: level S0 and no event', () => {
    const now = radiationNow(parseGoesProtons(rawGoes));
    expect(now.level).toBe(0);
    expect(now.levelName).toBe('none');
    expect(now.event.inProgress).toBe(false);
    expect(now.latest!.value).toBeLessThan(10);
    expect(now.s1Threshold).toBe(10);
  });

  it('reports the level of the latest reading and an event once the rise is sustained', () => {
    const now = radiationNow(series([0.3, 0.4, 15, 80, 400, 1500, 1200]));
    expect(now.level).toBe(3);
    expect(now.levelName).toBe('strong');
    expect(now.event).toMatchObject({ inProgress: true, level: 3, peakPfu: 1500 });
    expect(now.peak!.value).toBe(1500);
  });

  it('does not call a single spike an event', () => {
    const now = radiationNow(series([0.3, 0.4, 0.3, 300]));
    expect(now.level).toBe(2); // the reading itself is at S2
    expect(now.event.inProgress).toBe(false); // but one reading is not an event
  });

  it('has nothing to say without data', () => {
    expect(radiationNow([])).toMatchObject({ latest: null, level: 0, peak: null });
  });
});

describe('offline-first loading', () => {
  it('has a bundled snapshot with real flux and real DONKI events', () => {
    const weather = snapshotSpaceWeather();
    expect(weather.origin).toBe('snapshot');
    expect(weather.samples.length).toBeGreaterThan(300);
    expect(weather.events.length).toBeGreaterThan(0);
    for (const event of weather.events) {
      expect(event.link).toMatch(/^https:\/\//);
      expect(Number.isNaN(Date.parse(event.time))).toBe(false);
    }
  });

  it('uses the live feed when it answers', async () => {
    const weather = await loadSpaceWeather(answer(rawGoes));
    expect(weather.origin).toBe('live');
    expect(weather.satellite).toBe(rawGoes[0].satellite);
    expect(weather.now.level).toBe(0);
  });

  it('falls back to the snapshot when the network is down, the server errors or the answer is empty', async () => {
    const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    for (const fetchImpl of [offline, answer({ message: 'error' }, false, 503), answer([])]) {
      const weather = await loadSpaceWeather(fetchImpl);
      expect(weather.origin).toBe('snapshot');
      expect(weather.samples.length).toBeGreaterThan(300);
    }
  });
});

describe('simulator anchored to real space weather', () => {
  it('starts the simulated proton flux from the quiet level measured by GOES', () => {
    const store = new HealthStore('iss');
    const clock = new MissionClock(44 * 1440 + 480);
    const simulator = new SimulatedSource(clock, () => store.environment);
    simulator.connect(store);
    simulator.setQuietFlux(0.9);
    simulator.seedHistory(14);
    const recent = store.history('protonFlux').slice(-48).map((r) => r.value);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    expect(mean).toBeGreaterThan(0.8);
    expect(mean).toBeLessThan(1.0);
    expect(store.evaluation.systems.radiation.status).toBe('nominal');
  });

  it('ignores a real storm level: only the scenario can raise the simulated flux', () => {
    const store = new HealthStore('iss');
    const clock = new MissionClock(44 * 1440 + 480);
    const simulator = new SimulatedSource(clock, () => store.environment);
    simulator.connect(store);
    simulator.setQuietFlux(450);
    simulator.seedHistory(14);
    expect(Math.max(...store.history('protonFlux').map((r) => r.value))).toBeLessThan(10);
  });
});
