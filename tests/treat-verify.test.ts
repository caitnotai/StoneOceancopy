import { describe, expect, it } from 'vitest';
import { HealthStore } from '../src/data/HealthStore';
import { MissionClock } from '../src/data/MissionClock';
import { scenarioById } from '../src/data/sources/scenarios';
import { SimulatedSource } from '../src/data/sources/SimulatedSource';
import { INDICATOR_LIST, INDICATORS } from '../src/domain/catalog/indicators';
import { verificationWindowMin, verifyIntervention, type Intervention } from '../src/domain/engine/verify';
import { RULES } from '../src/domain/evidence/catalog';
import { DEFAULT_MEDICAL_PLAN, isPharmacological, offerSteps, WITHHELD_STEP } from '../src/domain/medicalPlan';
import type { IndicatorId, Reading } from '../src/domain/types';

const DAY = 1440;

describe('medical plan: drugs need pre-authorization', () => {
  const allGuidance = INDICATOR_LIST.flatMap((d) => [...d.guidance.caution, ...d.guidance.critical]);

  it('is off by default', () => {
    expect(DEFAULT_MEDICAL_PLAN.drugsPreauthorized).toBe(false);
    expect(new HealthStore().medicalPlan.drugsPreauthorized).toBe(false);
  });

  it('finds the drug steps in the existing guidance', () => {
    const drugSteps = allGuidance.filter(isPharmacological);
    expect(drugSteps).toHaveLength(3);
    expect(drugSteps.join(' ')).toMatch(/fever reducer/);
    expect(drugSteps.join(' ')).toMatch(/anti-motion-sickness medication/);
    expect(drugSteps.join(' ')).toMatch(/supplemental oxygen/);
  });

  it('withholds every drug step unless the plan pre-authorizes drugs', () => {
    const offered = offerSteps(allGuidance, { drugsPreauthorized: false });
    expect(offered.filter((s) => s.withheld)).toHaveLength(3);
    for (const step of offered) {
      if (step.withheld) expect(step.text).toBe(WITHHELD_STEP);
      else expect(isPharmacological(step.text)).toBe(false);
    }
    const authorized = offerSteps(allGuidance, { drugsPreauthorized: true });
    expect(authorized.some((s) => s.withheld)).toBe(false);
    expect(authorized.filter((s) => s.pharmacological)).toHaveLength(3);
  });

  it('recognizes every pre-authorization step of the rules matrix as a drug step', () => {
    for (const rule of RULES) {
      for (const step of rule.treat) expect(isPharmacological(step.text), `${rule.id}: ${step.text}`).toBe(step.requiresPreauthorization);
    }
  });
});

describe('verify: an intervention closes only on a measured response', () => {
  const def = INDICATORS.ppCO2; // hourly sensor: three readings back in range are needed
  const intervention: Intervention = {
    id: 1, indicatorId: 'ppCO2', ruleId: 'R-CO2', stepText: 'Increase CO2 scrubbing and ventilation.', authorityLevel: 1,
    startedAt: 1000, valueBefore: 4.2, statusBefore: 'caution', outcome: 'pending', valueAfter: null, checkedAt: null,
  };
  const series = (values: number[], start = 1060): Reading[] => values.map((value, i) => ({ indicatorId: 'ppCO2', value, t: start + i * 60, source: 'sensor' }));
  const check = (readings: Reading[], now: number, of = intervention) => verifyIntervention(of, def, readings, def.thresholds, now);

  it('stays pending right after the action, whatever was measured before it', () => {
    expect(check(series([2.0, 2.0, 2.0], 700), 1010).outcome).toBe('pending');
  });

  it('stays pending while the value is still coming down', () => {
    expect(check(series([4.0, 3.6, 3.2]), 1200).outcome).toBe('pending');
    expect(check(series([3.4, 2.9, 2.8]), 1200).outcome).toBe('pending'); // only two readings back in range
  });

  it('is verified by three consecutive readings back within the standard', () => {
    expect(check(series([3.6, 3.1, 2.9, 2.8, 2.7]), 1320)).toEqual({ outcome: 'verified', valueAfter: 2.7, checkedAt: 1300 });
  });

  it('is not verified when the window passes without the response', () => {
    const late = intervention.startedAt + verificationWindowMin(def) + 1;
    expect(check(series([4.1, 4.2, 4.3, 4.2, 4.4, 4.3]), late)).toMatchObject({ outcome: 'not_verified', valueAfter: 4.3 });
  });

  it('needs a single reading for indicators measured once a day', () => {
    const sleep: Intervention = { ...intervention, indicatorId: 'sleepHours', ruleId: 'R-SLEEP', startedAt: 0 };
    const night: Reading[] = [{ indicatorId: 'sleepHours', value: 7.6, t: DAY, source: 'sensor' }];
    expect(verifyIntervention(sleep, INDICATORS.sleepHours, night, INDICATORS.sleepHours.thresholds, DAY).outcome).toBe('verified');
  });

  it('never changes an outcome once it is decided', () => {
    const closed: Intervention = { ...intervention, outcome: 'not_verified', valueAfter: 4.3, checkedAt: 1500 };
    expect(check(series([2.0, 2.0, 2.0, 2.0]), 2000, closed)).toEqual({ outcome: 'not_verified', valueAfter: 4.3, checkedAt: 1500 });
  });
});

describe('detect, treat, verify end to end (simulated)', () => {
  function mission() {
    const store = new HealthStore('iss');
    const clock = new MissionClock(44 * DAY + 480);
    const simulator = new SimulatedSource(clock, () => store.environment);
    simulator.connect(store);
    simulator.seedHistory(14);
    const run = (hours: number): void => {
      for (let step = 0; step < hours; step++) {
        const previous = clock.now;
        clock.now += 60;
        store.ingest(simulator.advance(previous, clock.now), clock.now);
      }
    };
    const statusOf = (id: IndicatorId) => store.evaluation.systems[INDICATORS[id].systemId].indicators.find((i) => i.def.id === id)!.status;
    return { store, simulator, run, statusOf };
  }

  it('CO2 fault: detected, treated at authority level 1, verified by the falling CO2', () => {
    const { store, simulator, run, statusOf } = mission();
    simulator.setScenario(scenarioById('co2-fault'));
    run(12);
    expect(statusOf('ppCO2')).toBe('caution'); // detect

    const started = store.startIntervention('ppCO2', 'Increase CO2 scrubbing and ventilation.', 1); // treat
    simulator.applyCountermeasure('ppCO2');
    expect(started).toMatchObject({ ruleId: 'R-CO2', statusBefore: 'caution', outcome: 'pending' });
    expect(started.valueBefore).toBeGreaterThan(3);

    run(1);
    expect(store.latestIntervention('ppCO2')?.outcome).toBe('pending'); // carried out is not verified
    run(11);
    const closed = store.latestIntervention('ppCO2')!; // verify
    expect(closed.outcome).toBe('verified');
    expect(closed.valueAfter).toBeLessThanOrEqual(3);
    expect(statusOf('ppCO2')).toBe('nominal');
  });

  it('an action that does not work is reported as not verified', () => {
    const { store, simulator, run } = mission();
    simulator.setScenario(scenarioById('co2-fault'));
    run(12);
    store.startIntervention('ppCO2', 'Reduce metabolic load.', 2); // recorded, but the fault persists
    run(8);
    const result = store.latestIntervention('ppCO2')!;
    expect(result.outcome).toBe('not_verified');
    expect(result.valueAfter).toBeGreaterThan(3);
  });

  it('restarting the mission clears the intervention log', () => {
    const { store } = mission();
    store.startIntervention('mood', 'Share how you feel with a crewmate you trust.', 2);
    expect(store.interventions).toHaveLength(1);
    store.reset(0);
    expect(store.interventions).toHaveLength(0);
  });
});
