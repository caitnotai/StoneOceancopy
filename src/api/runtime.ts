import { HISTORY_DAYS, MISSION_START_MINUTES } from '../config';
import { HealthStore } from '../data/HealthStore';
import { MissionClock } from '../data/MissionClock';
import { scenarioById } from '../data/sources/scenarios';
import { SimulatedSource } from '../data/sources/SimulatedSource';
import { snapshotSpaceWeather, type SpaceWeather } from '../data/spaceWeather';
import type { Intervention } from '../domain/engine/verify';
import type { AuthorityLevel } from '../domain/evidence/types';
import type { IndicatorId, Reading } from '../domain/types';

/** The prototype follows one crew member. */
export const CREW_ID = 'crew-1';

/**
 * A mission running outside the browser: the same store, simulator and rules engine the
 * dashboard uses, with time advanced on request instead of by a timer. The API is a thin
 * layer over this object, so the dashboard and the API can never disagree.
 */
export class MissionRuntime {
  readonly store = new HealthStore('iss');
  readonly clock = new MissionClock(MISSION_START_MINUTES);
  readonly simulator: SimulatedSource;
  /** Bundled snapshot: the API works with no connection. */
  readonly weather: SpaceWeather = snapshotSpaceWeather();

  constructor() {
    this.simulator = new SimulatedSource(this.clock, () => this.store.environment);
    this.simulator.connect(this.store);
    this.store.setSpaceWeather(this.weather);
    this.simulator.setQuietFlux(this.weather.now.latest?.value ?? null);
    this.simulator.seedHistory(HISTORY_DAYS);
  }

  /** Advances mission time in one-hour steps, as the running clock would. */
  advance(hours: number): void {
    for (let step = 0; step < hours; step++) {
      const previous = this.clock.now;
      this.clock.now += 60;
      this.store.ingest(this.simulator.advance(previous, this.clock.now), this.clock.now);
    }
  }

  setScenario(id: string): string {
    const scenario = scenarioById(id);
    this.simulator.setScenario(scenario);
    return scenario.id;
  }

  /** A measurement taken by hand. */
  log(indicatorId: IndicatorId, value: number): Reading {
    const reading: Reading = { indicatorId, value, t: this.clock.now, source: 'manual' };
    this.simulator.absorb(reading);
    this.store.ingest([reading], this.clock.now);
    return reading;
  }

  /** Records a treatment step. `simulateEffect` makes the simulated physiology respond to it. */
  intervene(indicatorId: IndicatorId, stepText: string, authorityLevel: AuthorityLevel, simulateEffect: boolean): Intervention {
    const intervention = this.store.startIntervention(indicatorId, stepText, authorityLevel);
    if (simulateEffect) this.simulator.applyCountermeasure(indicatorId);
    return intervention;
  }
}
