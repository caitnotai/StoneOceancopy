import { describe, expect, it } from 'vitest';
import { HISTORY_DAYS } from '../src/config';
import { HealthStore } from '../src/data/HealthStore';
import { MissionClock } from '../src/data/MissionClock';
import { scenarioById } from '../src/data/sources/scenarios';
import { SimulatedSource } from '../src/data/sources/SimulatedSource';
import { SYSTEM_IDS } from '../src/domain/types';

const DAY = 1440;
const START = 44 * DAY + 480;

function setup(): { store: HealthStore; clock: MissionClock; simulator: SimulatedSource; run(days: number): void } {
  const store = new HealthStore('iss');
  const clock = new MissionClock(START);
  const simulator = new SimulatedSource(clock, () => store.environment);
  simulator.connect(store);
  simulator.seedHistory(HISTORY_DAYS);
  return {
    store,
    clock,
    simulator,
    // Advance in one-hour steps, the way the running clock would.
    run(days) {
      for (let step = 0; step < days * 24; step++) {
        const previous = clock.now;
        clock.now += 60;
        store.ingest(simulator.advance(previous, clock.now), clock.now);
      }
    },
  };
}

describe('simulated mission', () => {
  it('starts with enough history for a baseline and every system nominal', () => {
    const { store } = setup();
    expect(store.history('heartRate').length).toBeGreaterThan(600);
    // Fourteen complete days for the baseline, plus the measurement of the day that is starting.
    expect(store.history('sleepHours').length).toBe(HISTORY_DAYS);
    expect(store.baselineOf('sleepHours')).toMatchObject({ days: 14, until: START });
    expect(store.baselineOf('heartRate')?.days).toBe(14);
    expect(store.baselineOf('ppCO2')).toBeUndefined(); // judged by the NASA standard, not by a baseline
    for (const id of SYSTEM_IDS) expect(store.evaluation.systems[id].status, id).toBe('nominal');
    expect(store.evaluation.triage.level).toBe('nominal');
  });

  it('is reproducible: the same seed gives the same mission', () => {
    const a = setup().store.history('heartRate').map((r) => r.value);
    const b = setup().store.history('heartRate').map((r) => r.value);
    expect(a).toEqual(b);
  });

  it('stays nominal through a week of routine', () => {
    const { store, run } = setup();
    run(7);
    expect(store.evaluation.triage.level).toBe('nominal');
  });

  it('turns bone and muscle from nominal to critical when exercise stops', () => {
    const { store, simulator, run } = setup();
    simulator.setScenario(scenarioById('exercise-gap'));
    run(1);
    // One shorter session is within this person's own day-to-day variation: not yet a change.
    expect(store.evaluation.systems.skeletal.status).toBe('nominal');
    run(7);
    // Day after day below the baseline: the drift detectors flag it.
    expect(store.evaluation.systems.skeletal.status).toBe('critical');
    expect(store.evaluation.systems.skeletal.driver?.drift?.trigger).toBeTruthy();
    // Single readings are noisy: the muscle indicator must have reached the critical band and still be flagged.
    expect(Math.min(...store.history('aerobicExercise').slice(-4).map((r) => r.value))).toBeLessThan(15);
    expect(store.evaluation.systems.muscular.status).not.toBe('nominal');
    expect(store.evaluation.systems.cardiovascular.status).toBe('nominal');
  });

  it('adds the dose of a solar particle event on top of the background rate', () => {
    const { store, simulator, run } = setup();
    const before = store.history('radiationDose').at(-1)!.value;
    simulator.setScenario(scenarioById('solar-event'));
    run(1);
    const after = store.history('radiationDose').at(-1)!.value;
    expect(after - before).toBeGreaterThan(315);
    expect(after - before).toBeLessThan(325);
  });

  it('judges a solar event by the proton flux, never by an invented dose band', () => {
    const { store, simulator, run } = setup();
    simulator.setScenario(scenarioById('solar-event'));
    run(0.25); // six hours in: flux at NOAA level S3
    expect(store.evaluation.systems.radiation.status).toBe('critical');
    expect(store.evaluation.systems.radiation.driver?.def.id).toBe('protonFlux');
    run(1.5); // the event is over and the flux is quiet again
    expect(store.history('protonFlux').at(-1)!.value).toBeLessThan(10);
    // More than 300 mSv were added, and with no mission budget set the dose alone raises nothing.
    expect(store.history('radiationDose').at(-1)!.value).toBeGreaterThan(300);
    expect(store.evaluation.systems.radiation.status).toBe('nominal');
  });

  it('halves the event dose once the crew member has taken shelter', () => {
    const exposed = setup();
    exposed.simulator.setScenario(scenarioById('solar-event'));
    exposed.run(1);
    const sheltered = setup();
    sheltered.simulator.setScenario(scenarioById('solar-event'));
    sheltered.simulator.applyCountermeasure('protonFlux');
    sheltered.run(1);
    const gain = (s: typeof exposed): number => s.store.history('radiationDose').at(-1)!.value - s.store.history('radiationDose').at(-13)!.value;
    expect(gain(sheltered) / gain(exposed)).toBeCloseTo(0.5, 1);
  });

  it('flags cabin CO2 above the 3 mmHg standard as caution and recovers after the countermeasure', () => {
    const { store, simulator, run } = setup();
    simulator.setScenario(scenarioById('co2-fault'));
    run(1);
    expect(store.history('ppCO2').at(-1)!.value).toBeGreaterThan(3);
    // Off-nominal limits belong to the program: above the standard is caution, never critical.
    expect(store.evaluation.systems.respiratory.status).toBe('caution');
    expect(store.evaluation.systems.respiratory.driver?.def.id).toBe('ppCO2');
    simulator.applyCountermeasure('ppCO2');
    run(1);
    expect(store.history('ppCO2').at(-1)!.value).toBeLessThanOrEqual(3);
    expect(store.evaluation.systems.respiratory.status).toBe('nominal');
  });

  it('follows the NASA SANS criteria: 20 um is caution, 55 um is critical', () => {
    const { store, simulator, run } = setup();
    simulator.setScenario(scenarioById('sans'));
    const seen = new Set<string>();
    for (let day = 0; day < 24; day += 3) {
      run(3);
      const thickness = store.history('retinalThickness').at(-1)!.value;
      const status = store.evaluation.systems.sensory.indicators.find((i) => i.def.id === 'retinalThickness')!.status;
      expect(status, `${thickness} um`).toBe(thickness >= 55 ? 'critical' : thickness >= 20 ? 'caution' : 'nominal');
      seen.add(status);
    }
    expect(seen.has('caution')).toBe(true);
    expect(seen.has('critical')).toBe(true);
  });

  it('stops delivering self-checks when auto-logging is off, so they become due', () => {
    const { store, simulator, run } = setup();
    simulator.autoLogSelfChecks = false;
    run(2);
    const due = store.evaluation.due.map((d) => d.def.id);
    expect(due).toContain('mood');
    expect(due).toContain('glucose');
    expect(due).not.toContain('heartRate');
  });

  it('continues from a manually logged value', () => {
    const { store, simulator, clock } = setup();
    const log = (value: number): void => {
      const reading = { indicatorId: 'mood' as const, value, t: clock.now, source: 'manual' as const };
      simulator.absorb(reading);
      store.ingest([reading], clock.now);
    };
    // Judged against this person's baseline (about 7.7 out of 10): 3 is far from it, 1 is extreme.
    log(3);
    expect(store.evaluation.systems.neuro.status).not.toBe('nominal');
    expect(store.evaluation.systems.neuro.driver?.def.id).toBe('mood');
    expect(store.evaluation.systems.neuro.driver?.drift?.trigger).toBe('single_value');
    log(1); // a repeated measurement replaces the day's value
    expect(store.evaluation.systems.neuro.status).toBe('critical');
  });

  it('rarely raises an alert on a healthy crew member', () => {
    // Ten healthy 30-day missions, eleven indicators judged against the baseline in each.
    let flagged = 0;
    let critical = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const store = new HealthStore('iss');
      const clock = new MissionClock(START);
      const simulator = new SimulatedSource(clock, () => store.environment, seed * 97);
      simulator.connect(store);
      simulator.seedHistory(HISTORY_DAYS);
      const seen = new Map<string, string>();
      for (let hour = 0; hour < 30 * 24; hour++) {
        const previous = clock.now;
        clock.now += 60;
        store.ingest(simulator.advance(previous, clock.now), clock.now);
        for (const id of SYSTEM_IDS) {
          for (const i of store.evaluation.systems[id].indicators) {
            if (!i.drift || i.status === 'nominal') continue;
            if (seen.get(i.def.id) !== 'critical') seen.set(i.def.id, i.status);
          }
        }
      }
      flagged += seen.size;
      critical += [...seen.values()].filter((s) => s === 'critical').length;
    }
    // Calibrated for about 3.8% (caution) and 0.4% (critical) per indicator per 30 days: 110 indicator-missions here.
    expect(flagged).toBeLessThanOrEqual(8);
    expect(critical).toBeLessThanOrEqual(2);
  });
});
