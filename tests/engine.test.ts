import { describe, expect, it } from 'vitest';
import { ENVIRONMENTS } from '../src/domain/catalog/environments';
import { INDICATORS, INDICATOR_LIST } from '../src/domain/catalog/indicators';
import { SYSTEMS } from '../src/domain/catalog/systems';
import { classify, evaluateAll, evaluateIndicator, trendPerDay } from '../src/domain/engine/evaluate';
import { SYSTEM_IDS, type IndicatorId, type Reading } from '../src/domain/types';

const DAY = 1440;
const reading = (indicatorId: IndicatorId, value: number, t: number): Reading => ({ indicatorId, value, t, source: 'simulated' });

/** One nominal reading per indicator at time `t`, with optional overrides. */
function snapshot(t: number, overrides: Partial<Record<IndicatorId, number>> = {}): Map<IndicatorId, Reading[]> {
  const nominal: Record<IndicatorId, number> = {
    heartRate: 62,
    systolicBP: 117,
    resistiveExercise: 60,
    aerobicExercise: 40,
    spo2: 98,
    sleepHours: 7.6,
    mood: 8,
    visionChange: 1,
    dizziness: 1,
    bodyTemp: 36.8,
    glucose: 95,
    calorieIntake: 100,
    radiationDose: 30,
  };
  const map = new Map<IndicatorId, Reading[]>();
  for (const def of INDICATOR_LIST) map.set(def.id, [reading(def.id, overrides[def.id] ?? nominal[def.id], t)]);
  return map;
}

describe('catalog', () => {
  it('gives every body system at least one indicator', () => {
    for (const id of SYSTEM_IDS) expect(INDICATOR_LIST.some((d) => d.systemId === id), id).toBe(true);
  });

  it('keeps every caution range around its nominal range, inside the display range', () => {
    for (const def of INDICATOR_LIST) {
      const { nominal, caution } = def.thresholds;
      expect(caution.min, def.id).toBeLessThanOrEqual(nominal.min);
      expect(caution.max, def.id).toBeGreaterThanOrEqual(nominal.max);
      expect(nominal.min, def.id).toBeGreaterThanOrEqual(def.display.min);
      expect(def.guidance.caution.length, def.id).toBeGreaterThan(0);
      expect(def.guidance.critical.length, def.id).toBeGreaterThan(0);
    }
  });

  it('links every system to a NASA risk', () => {
    for (const id of SYSTEM_IDS) expect(SYSTEMS[id].risks.length, id).toBeGreaterThan(0);
  });
});

describe('classify', () => {
  const th = INDICATORS.heartRate.thresholds; // nominal 50-100, caution 40-120

  it('maps values to statuses, boundaries included', () => {
    expect(classify(62, th)).toBe('nominal');
    expect(classify(50, th)).toBe('nominal');
    expect(classify(100, th)).toBe('nominal');
    expect(classify(101, th)).toBe('caution');
    expect(classify(45, th)).toBe('caution');
    expect(classify(121, th)).toBe('critical');
    expect(classify(39, th)).toBe('critical');
    expect(classify(Number.NaN, th)).toBe('unknown');
  });

  it('handles open-ended ranges', () => {
    const exercise = INDICATORS.resistiveExercise.thresholds; // nominal >= 45, caution >= 20
    expect(classify(500, exercise)).toBe('nominal');
    expect(classify(30, exercise)).toBe('caution');
    expect(classify(5, exercise)).toBe('critical');
  });
});

describe('evaluateIndicator', () => {
  const env = ENVIRONMENTS.iss;

  it('reports unknown and due when there is no data', () => {
    const result = evaluateIndicator(INDICATORS.mood, [], env, 0);
    expect(result.status).toBe('unknown');
    expect(result.due).toBe(true);
  });

  it('marks a reading as due once it is older than the cadence', () => {
    const readings = [reading('systolicBP', 118, 0)];
    expect(evaluateIndicator(INDICATORS.systolicBP, readings, env, 23 * 60).due).toBe(false);
    expect(evaluateIndicator(INDICATORS.systolicBP, readings, env, 25 * 60).due).toBe(true);
  });

  it('flags a worsening trend before the threshold is crossed', () => {
    // Sleep falling 0.4 h per night, still nominal today (7.2 h) but under 7 h within two days.
    const readings = [0, 1, 2, 3].map((d) => reading('sleepHours', 8.4 - 0.4 * d, d * DAY));
    const result = evaluateIndicator(INDICATORS.sleepHours, readings, env, 3 * DAY);
    expect(result.status).toBe('nominal');
    expect(result.trendPerDay).toBeCloseTo(-0.4, 5);
    expect(result.worsening).toBe(true);
  });

  it('applies per-environment threshold overrides', () => {
    const strict = { ...env, thresholdOverrides: { heartRate: { nominal: { min: 50, max: 60 }, caution: { min: 40, max: 120 } } } };
    const readings = [reading('heartRate', 62, 0)];
    expect(evaluateIndicator(INDICATORS.heartRate, readings, env, 0).status).toBe('nominal');
    expect(evaluateIndicator(INDICATORS.heartRate, readings, strict, 0).status).toBe('caution');
  });
});

describe('trendPerDay', () => {
  it('needs at least three readings', () => {
    expect(trendPerDay([reading('mood', 7, 0), reading('mood', 6, DAY)], DAY)).toBeNull();
  });

  it('ignores readings older than the window', () => {
    const old = [reading('mood', 1, -30 * DAY), reading('mood', 9, -29 * DAY)];
    const flat = [0, 1, 2].map((d) => reading('mood', 7, d * DAY));
    expect(trendPerDay([...old, ...flat], 2 * DAY)).toBeCloseTo(0, 6);
  });
});

describe('evaluateAll and triage', () => {
  it('is all clear for a healthy crew member', () => {
    const result = evaluateAll(snapshot(0), ENVIRONMENTS.iss, 0);
    for (const id of SYSTEM_IDS) expect(result.systems[id].status, id).toBe('nominal');
    expect(result.triage.level).toBe('nominal');
    expect(result.due).toHaveLength(0);
  });

  it('takes the worst indicator as the system status and names it as the driver', () => {
    const result = evaluateAll(snapshot(0, { heartRate: 110, systolicBP: 170 }), ENVIRONMENTS.iss, 0);
    expect(result.systems.cardiovascular.status).toBe('critical');
    expect(result.systems.cardiovascular.driver?.def.id).toBe('systolicBP');
  });

  it('escalates: one caution is self-care, two involve the crew medical officer', () => {
    const one = evaluateAll(snapshot(0, { sleepHours: 6 }), ENVIRONMENTS.iss, 0);
    expect(one.triage.level).toBe('self-care');
    expect(one.triage.systems).toEqual(['neuro']);
    const two = evaluateAll(snapshot(0, { sleepHours: 6, aerobicExercise: 20 }), ENVIRONMENTS.iss, 0);
    expect(two.triage.level).toBe('crew-medical');
  });

  it('changes the critical instruction with distance from Earth', () => {
    const fever = snapshot(0, { bodyTemp: 39.2 });
    const nearEarth = evaluateAll(fever, ENVIRONMENTS.iss, 0).triage;
    const deepSpace = evaluateAll(fever, ENVIRONMENTS.mars, 0).triage;
    expect(nearEarth.level).toBe('ground-consult');
    expect(nearEarth.headline).toMatch(/flight surgeon now/i);
    expect(deepSpace.level).toBe('ground-consult');
    expect(deepSpace.headline).toMatch(/onboard protocol/i);
    expect(deepSpace.detail).toContain('40 min');
  });

  it('lists overdue self-checks but not overdue sensors', () => {
    const result = evaluateAll(snapshot(0), ENVIRONMENTS.iss, 3 * DAY);
    const ids = result.due.map((d) => d.def.id);
    expect(ids).toContain('mood');
    expect(ids).toContain('systolicBP');
    expect(ids).not.toContain('heartRate');
  });
});
