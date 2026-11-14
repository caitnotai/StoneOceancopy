import { INDICATORS } from '../../domain/catalog/indicators';
import type { EnvironmentDef, IndicatorId, MissionMinutes, Reading } from '../../domain/types';
import type { ReadingSink } from '../HealthStore';
import { MINUTES_PER_DAY, type MissionClock } from '../MissionClock';
import { SCENARIOS, type ScenarioDef } from './scenarios';
import type { SensorSource } from './SensorSource';

interface ChannelSpec {
  baseline: number;
  /** Standard deviation of measurement noise. */
  noise: number;
  /** Minutes between samples. */
  intervalMin: number;
  /** How fast the value drifts toward its target, in hours. */
  tauHours: number;
  /** Amplitude of the day-night rhythm, if any. */
  circadian?: number;
}

/** A plausible healthy crew member. Radiation is handled separately: it is cumulative. */
const CHANNELS: Record<Exclude<IndicatorId, 'radiationDose'>, ChannelSpec> = {
  heartRate: { baseline: 62, noise: 2.2, intervalMin: 30, tauHours: 8, circadian: 4 },
  systolicBP: { baseline: 117, noise: 3, intervalMin: 1440, tauHours: 24 },
  resistiveExercise: { baseline: 62, noise: 4, intervalMin: 1440, tauHours: 60 },
  aerobicExercise: { baseline: 42, noise: 3, intervalMin: 1440, tauHours: 60 },
  spo2: { baseline: 97.6, noise: 0.45, intervalMin: 30, tauHours: 6 },
  sleepHours: { baseline: 7.7, noise: 0.22, intervalMin: 1440, tauHours: 30 },
  mood: { baseline: 7.6, noise: 0.35, intervalMin: 1440, tauHours: 48 },
  visionChange: { baseline: 0.7, noise: 0.25, intervalMin: 4320, tauHours: 96 },
  dizziness: { baseline: 0.8, noise: 0.3, intervalMin: 1440, tauHours: 24 },
  bodyTemp: { baseline: 36.8, noise: 0.07, intervalMin: 60, tauHours: 8, circadian: 0.18 },
  glucose: { baseline: 94, noise: 4, intervalMin: 1440, tauHours: 24 },
  calorieIntake: { baseline: 100, noise: 2.5, intervalMin: 1440, tauHours: 30 },
  ppCO2: { baseline: 2.1, noise: 0.12, intervalMin: 60, tauHours: 5 },
  retinalThickness: { baseline: 6, noise: 2, intervalMin: 4320, tauHours: 96 },
  // Quiet-sun level, as in the GOES snapshot of 14 Nov 2026 (0.17 to 0.48 pfu).
  protonFlux: { baseline: 0.3, noise: 0.06, intervalMin: 30, tauHours: 4 },
};

const RADIATION_INTERVAL_MIN = 120;
/** Share of a solar-event dose still received inside the storm shelter (about 50% reduction; see E-RAD-SHIELDING). */
const SHELTER_DOSE_FACTOR = 0.5;

interface ChannelState {
  level: number;
  updatedAt: MissionMinutes;
  nextSampleAt: MissionMinutes;
}

/** Small deterministic PRNG so every demo run looks the same. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * Simulated wearables and self-checks. Each indicator is a noisy value that drifts toward
 * a target; a scenario simply moves the targets, so changes look gradual and physiological.
 */
export class SimulatedSource implements SensorSource {
  readonly id = 'simulator';

  /** When false, self-check indicators stop arriving and the crew member is prompted to log them. */
  autoLogSelfChecks = true;

  private sink: ReadingSink | null = null;
  private unsubscribe: (() => void) | null = null;
  private channels = new Map<IndicatorId, ChannelState>();
  private random: () => number;
  private scenario: ScenarioDef = SCENARIOS[0];
  private scenarioStartedAt: MissionMinutes = 0;
  /** Indicators for which a countermeasure has been carried out during this scenario. */
  private readonly countered = new Set<IndicatorId>();

  constructor(
    private readonly clock: MissionClock,
    private readonly environment: () => EnvironmentDef,
    private readonly seed = 2026,
  ) {
    this.random = mulberry32(seed);
  }

  get activeScenario(): ScenarioDef {
    return this.scenario;
  }

  setScenario(scenario: ScenarioDef): void {
    this.scenario = scenario;
    this.scenarioStartedAt = this.clock.now;
    this.countered.clear();
  }

  /**
   * Simulates an effective countermeasure: from now on the scenario stops pushing this
   * indicator, so it recovers at its own pace and the Verify step has a response to
   * measure. Sheltering does not lower the proton flux; it halves the event dose instead.
   */
  applyCountermeasure(id: IndicatorId): void {
    this.countered.add(id);
  }

  connect(sink: ReadingSink): void {
    this.sink = sink;
    this.unsubscribe = this.clock.onTick((now, previous) => sink.ingest(this.advance(previous, now), now));
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sink = null;
  }

  /**
   * (Re)starts the mission: builds `historyDays` of nominal history ending at the clock's
   * current time, so charts have a baseline from the first second.
   */
  seedHistory(historyDays: number): void {
    this.random = mulberry32(this.seed);
    this.scenario = SCENARIOS[0];
    this.countered.clear();
    const now = this.clock.now;
    const start = now - historyDays * MINUTES_PER_DAY;
    this.channels.clear();
    for (const [id, spec] of Object.entries(CHANNELS) as [IndicatorId, ChannelSpec][]) {
      this.channels.set(id, { level: spec.baseline, updatedAt: start, nextSampleAt: start + spec.intervalMin });
    }
    const doseAtStart = (this.environment().radiationMSvPerDay * start) / MINUTES_PER_DAY;
    this.channels.set('radiationDose', {
      level: Math.max(0, doseAtStart),
      updatedAt: start,
      nextSampleAt: start + RADIATION_INTERVAL_MIN,
    });
    this.scenarioStartedAt = now;
    this.sink?.ingest(this.advance(start, now), now);
  }

  /** A manual log becomes the simulator's new starting point for that indicator. */
  absorb(reading: Reading): void {
    const state = this.channels.get(reading.indicatorId);
    if (!state) return;
    const interval =
      reading.indicatorId === 'radiationDose' ? RADIATION_INTERVAL_MIN : CHANNELS[reading.indicatorId].intervalMin;
    state.level = reading.value;
    state.updatedAt = reading.t;
    state.nextSampleAt = reading.t + interval;
  }

  /** Produces every reading that falls due in (from, to]. Pure with respect to the clock. */
  advance(from: MissionMinutes, to: MissionMinutes): Reading[] {
    const out: Reading[] = [];
    for (const [id, state] of this.channels) {
      const def = INDICATORS[id];
      if (def.acquisition === 'self-check' && !this.autoLogSelfChecks) {
        // Keep the schedule moving so auto-logging can resume cleanly later.
        while (state.nextSampleAt <= to) state.nextSampleAt += CHANNELS[id as keyof typeof CHANNELS].intervalMin;
        continue;
      }
      while (state.nextSampleAt <= to) {
        const t = state.nextSampleAt;
        const value = id === 'radiationDose' ? this.sampleRadiation(state, t) : this.sampleChannel(id, state, t);
        if (t > from) out.push({ indicatorId: id, value, t, source: 'simulated' });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  private sampleChannel(id: IndicatorId, state: ChannelState, t: MissionMinutes): number {
    const spec = CHANNELS[id as keyof typeof CHANNELS];
    const def = INDICATORS[id];
    let effect = this.scenario.effects[id];
    // A countermeasure removes the scenario's push, except on the proton flux itself.
    if (this.countered.has(id) && id !== 'protonFlux') effect = undefined;
    // A solar event ends: after the burst, the flux relaxes back to the quiet level.
    const burst = this.scenario.radiationBurst;
    if (id === 'protonFlux' && burst && t > this.scenarioStartedAt + burst.hours * 60) effect = undefined;
    const target = effect?.target ?? spec.baseline;
    const tau = (effect?.tauHours ?? spec.tauHours) * 60;
    state.level += (target - state.level) * (1 - Math.exp(-(t - state.updatedAt) / tau));
    state.updatedAt = t;
    state.nextSampleAt = t + spec.intervalMin;
    const rhythm = spec.circadian ? spec.circadian * Math.sin((2 * Math.PI * (t - 360)) / MINUTES_PER_DAY) : 0;
    const value = state.level + rhythm + spec.noise * this.gaussian();
    const factor = 10 ** def.decimals;
    return Math.round(clamp(value, def.display.min, def.display.max) * factor) / factor;
  }

  private sampleRadiation(state: ChannelState, t: MissionMinutes): number {
    const days = (t - state.updatedAt) / MINUTES_PER_DAY;
    let dose = this.environment().radiationMSvPerDay * days;
    const burst = this.scenario.radiationBurst;
    if (burst) {
      const burstStart = this.scenarioStartedAt;
      const burstEnd = burstStart + burst.hours * 60;
      const overlap = Math.max(0, Math.min(t, burstEnd) - Math.max(state.updatedAt, burstStart));
      const sheltered = this.countered.has('protonFlux') || this.countered.has('radiationDose');
      dose += burst.totalMSv * (overlap / (burst.hours * 60)) * (sheltered ? SHELTER_DOSE_FACTOR : 1);
    }
    state.level += dose;
    state.updatedAt = t;
    state.nextSampleAt = t + RADIATION_INTERVAL_MIN;
    return Math.round(state.level * 10) / 10;
  }

  private gaussian(): number {
    const u = Math.max(this.random(), 1e-9);
    const v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
