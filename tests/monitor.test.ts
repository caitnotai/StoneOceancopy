import { describe, expect, it } from 'vitest';
import calibration from '../data/validation/drift-calibration.json';
import { ENVIRONMENTS } from '../src/domain/catalog/environments';
import { INDICATOR_LIST, INDICATORS } from '../src/domain/catalog/indicators';
import { classify, evaluateIndicator } from '../src/domain/engine/evaluate';
import { currentValue, dailyValues, fitIndividualBaseline, MONITORING, monitor, usesIndividualBaseline } from '../src/domain/engine/monitor';
import { verificationWindowMin, verifyIntervention, type Intervention } from '../src/domain/engine/verify';
import { provenanceOf } from '../src/domain/evidence/indicatorRules';
import type { IndicatorId, Reading } from '../src/domain/types';

const DAY = 1440;
/** Start of crew day `day` (08:00), plus some hours. */
const at = (day: number, hours = 0): number => MONITORING.dayStartMinute + day * DAY + hours * 60;

/** One measurement per crew day, taken as the day starts. */
const daily = (id: IndicatorId, values: number[], firstDay = 0): Reading[] =>
  values.map((value, i) => ({ indicatorId: id, value, t: at(firstDay + i), source: 'sensor' }));

/** A sensor sampled every `stepMin` minutes over whole crew days; `valueAt` gets the day and the time. */
const sensor = (id: IndicatorId, days: number, stepMin: number, valueAt: (day: number, t: number) => number): Reading[] => {
  const out: Reading[] = [];
  for (let t = at(0) + stepMin; t <= at(days); t += stepMin) {
    const day = Math.floor((t - MONITORING.dayStartMinute) / DAY);
    out.push({ indicatorId: id, value: valueAt(day, t), t, source: 'sensor' });
  }
  return out;
};

const sleep = INDICATORS.sleepHours;
/** Fourteen nights alternating 7 and 8 hours: mean 7.5 h, predictive SD about 0.54 h. */
const usualNights = daily('sleepHours', Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 7 : 8)));
const sleepBaseline = fitIndividualBaseline(sleep, usualNights, at(14))!;

/** The usual nights followed by `later` nights; judged an hour after the last one was logged. */
const afterNights = (later: number[], resetAt: number | null = null) => {
  const readings = [...usualNights, ...daily('sleepHours', later, 14)];
  const now = at(14 + later.length - 1, 1);
  return monitor(sleep, readings, sleepBaseline, now, resetAt);
};

describe('daily values', () => {
  it('opens a new crew day at 08:00', () => {
    const readings: Reading[] = [
      { indicatorId: 'sleepHours', value: 7, t: at(1) - 1, source: 'sensor' },
      { indicatorId: 'sleepHours', value: 8, t: at(1), source: 'sensor' },
    ];
    expect(dailyValues(sleep, readings, at(3)).map((d) => [d.end, d.value])).toEqual([
      [at(1), 7],
      [at(2), 8],
    ]);
  });

  it('takes the mean of the day for a sensor and the latest measurement for a daily measure', () => {
    const heart = sensor('heartRate', 1, 60, (_, t) => (Math.round(t / 60) % 2 === 0 ? 60 : 64));
    expect(dailyValues(INDICATORS.heartRate, heart, at(1))[0].value).toBeCloseTo(62, 0);
    const twice: Reading[] = [
      { indicatorId: 'sleepHours', value: 5, t: at(0, 1), source: 'sensor' },
      { indicatorId: 'sleepHours', value: 7.5, t: at(0, 2), source: 'manual' },
    ];
    expect(dailyValues(sleep, twice, at(1))[0]).toMatchObject({ value: 7.5, readings: 2, at: at(0, 2) });
  });

  it('marks the running day as incomplete and skips a sensor day with too few readings', () => {
    const heart = sensor('heartRate', 1, 60, () => 62).filter((r) => r.t <= at(0, 3));
    expect(dailyValues(INDICATORS.heartRate, heart, at(0, 3))).toEqual([]); // three readings so far
    const more = sensor('heartRate', 1, 60, () => 62).filter((r) => r.t <= at(0, 6));
    expect(dailyValues(INDICATORS.heartRate, more, at(0, 6))[0]).toMatchObject({ complete: false, readings: 6 });
  });
});

describe('individual baseline', () => {
  it('needs 14 complete days and is fitted from them alone', () => {
    expect(fitIndividualBaseline(sleep, usualNights.slice(0, 13), at(14))).toBeNull();
    expect(fitIndividualBaseline(sleep, usualNights, at(13, 1))).toBeNull(); // the 14th day is still running
    expect(sleepBaseline).toMatchObject({ days: 14, until: at(14) });
    expect(sleepBaseline.baseline.mean).toBeCloseTo(7.5, 6);
    expect(sleepBaseline.baseline.sd).toBeCloseTo(0.537, 3);
  });

  it('is frozen: what happens later does not move it', () => {
    const later = [...usualNights, ...daily('sleepHours', [4, 4, 4, 4, 4, 4], 14)];
    expect(fitIndividualBaseline(sleep, later, at(20))!.baseline).toEqual(sleepBaseline.baseline);
  });

  it('never has zero spread, even from constant readings', () => {
    const constant = fitIndividualBaseline(sleep, daily('sleepHours', Array.from({ length: 14 }, () => 7.5)), at(14))!;
    expect(constant.baseline.sd).toBe(0.5 / 10 ** sleep.decimals);
  });

  it('covers exactly the indicators without a NASA limit or an operational scale of their own', () => {
    const monitored = INDICATOR_LIST.filter((d) => usesIndividualBaseline(d.id)).map((d) => d.id);
    expect(monitored).toHaveLength(11);
    for (const id of ['ppCO2', 'retinalThickness', 'protonFlux', 'radiationDose', 'visionChange'] as const) expect(monitored).not.toContain(id);
  });
});

describe('monitoring against the baseline', () => {
  it('takes its limits from the calibration file, not from the code', () => {
    const { caution, critical } = calibration.operational.levels;
    expect(MONITORING.caution).toEqual({ ewmaLimit: caution.ewmaLimit, cusumH: caution.cusumH, singleValueLimit: caution.singleValueLimit });
    expect(MONITORING.critical).toEqual({ ewmaLimit: critical.ewmaLimit, cusumH: critical.cusumH, singleValueLimit: critical.singleValueLimit });
    expect(caution.jointFalseAlarm).toBeLessThan(caution.targetFalseAlarm);
    expect(critical.jointFalseAlarm).toBeLessThan(critical.targetFalseAlarm);
  });

  it('is nominal while the person stays at their baseline', () => {
    const result = afterNights([7.5, 7.2, 7.9]);
    expect(result).toMatchObject({ status: 'nominal', trigger: null, awaitingFirstValue: false });
    expect(result.series).toHaveLength(3);
    expect(result.usualRange.min).toBeCloseTo(7.5 - 1.96 * sleepBaseline.baseline.sd, 6);
    expect(result.usualRange.max).toBe(Number.POSITIVE_INFINITY); // sleeping more is not a problem
  });

  it('flags one value far from the baseline at once', () => {
    const bad = afterNights([7.5, 4.9]); // 4.8 SD below
    expect(bad).toMatchObject({ status: 'caution', trigger: 'single_value' });
    expect(bad.current?.z).toBeCloseTo((4.9 - 7.5) / sleepBaseline.baseline.sd, 6);
    expect(afterNights([7.5, 4.0])).toMatchObject({ status: 'critical', trigger: 'single_value' }); // 6.5 SD below
  });

  it('flags a sustained drift that no single day would flag', () => {
    const nights = Array.from({ length: 8 }, () => 6.4); // 2 SD below, night after night
    const result = afterNights(nights);
    for (const day of result.series) expect(Math.abs(day.z)).toBeLessThan(MONITORING.caution.singleValueLimit);
    expect(result).toMatchObject({ status: 'caution', trigger: 'ewma' });
    expect(afterNights(nights.slice(0, 3)).status).toBe('nominal'); // three such nights are not yet enough
  });

  it('ignores a change in the direction that is not a problem', () => {
    expect(afterNights([10, 10, 10, 10]).status).toBe('nominal');
  });

  it('restarts after a treatment: the earlier status stands until a new value arrives', () => {
    const treatedAt = at(15, 0.5);
    const waiting = afterNights([7.5, 4.0], treatedAt);
    expect(waiting).toMatchObject({ status: 'critical', awaitingFirstValue: true });

    const recovered = afterNights([7.5, 4.0, 7.4], treatedAt);
    expect(recovered).toMatchObject({ status: 'nominal', awaitingFirstValue: false });
    expect(recovered.series).toHaveLength(1); // only the night after the treatment counts

    expect(afterNights([7.5, 4.0, 4.1], treatedAt)).toMatchObject({ status: 'critical', awaitingFirstValue: false });
  });
});

describe('sensors against the baseline', () => {
  const heart = INDICATORS.heartRate;
  /** A day-night rhythm of 4 bpm around a level that alternates between 61 and 63 from day to day. */
  const rhythm = (day: number, t: number): number => 62 + (day % 2 === 0 ? -1 : 1) + 4 * Math.sin((2 * Math.PI * (t - 360)) / DAY);
  const readings = sensor('heartRate', 16, 30, rhythm);
  const baseline = fitIndividualBaseline(heart, readings, at(16))!;

  it('does not mistake the day-night rhythm for a change', () => {
    // The first hours of a crew day run well above the daily mean...
    const morning = readings.filter((r) => r.t > at(15) && r.t <= at(15, 4));
    const morningMean = morning.reduce((sum, r) => sum + r.value, 0) / morning.length;
    expect(morningMean - baseline.baseline.mean).toBeGreaterThan(2 * baseline.baseline.sd);
    // ...so the value compared with the baseline is the mean of the last 24 hours.
    for (const hours of [2, 4, 8, 12, 16, 20]) {
      const now = at(15, hours);
      const result = monitor(heart, readings.filter((r) => r.t <= now), baseline, now);
      expect(result.status, `${hours} h into the day`).toBe('nominal');
      expect(Math.abs(result.current!.z), `${hours} h into the day`).toBeLessThan(1.5);
    }
  });

  it('feeds the detectors whole days only', () => {
    const now = at(15, 12);
    const result = monitor(heart, readings.filter((r) => r.t <= now), baseline, now);
    expect(result.series).toHaveLength(1); // day 14; day 15 is still running
  });

  it('shows a sudden change in the 24-hour mean within hours', () => {
    const temp = INDICATORS.bodyTemp;
    const usual = sensor('bodyTemp', 15, 60, (day) => 36.8 + (day % 2 === 0 ? -0.1 : 0.1));
    const own = fitIndividualBaseline(temp, usual, at(15))!;
    const fever = sensor('bodyTemp', 16, 60, (day) => (day >= 15 ? 38.5 : 36.8 + (day % 2 === 0 ? -0.1 : 0.1)));
    const judgedAt = (hours: number) => monitor(temp, fever.filter((r) => r.t <= at(15, hours)), own, at(15, hours));
    expect(judgedAt(2).status).toBe('nominal');
    expect(judgedAt(10)).toMatchObject({ trigger: 'single_value' });
    expect(judgedAt(10).status).not.toBe('nominal');
    expect(judgedAt(16).status).toBe('critical');
  });

  it('needs a full 24 hours after a treatment before it has a value to compare', () => {
    const treatedAt = at(15, 2);
    const upTo = (now: number) => readings.filter((r) => r.t <= now);
    expect(currentValue(heart, upTo(at(15, 14)), at(15, 14), treatedAt)).toBeNull();
    expect(monitor(heart, upTo(at(15, 14)), baseline, at(15, 14), treatedAt).awaitingFirstValue).toBe(true);
    expect(currentValue(heart, readings, at(16), treatedAt)).toBeNull(); // 22 hours
  });
});

describe('the engine and the labels', () => {
  const readings = [...usualNights, ...daily('sleepHours', [7.5, 6.4], 14)];
  const now = at(15, 1);

  it('uses the baseline when there is one and the illustrative range until then', () => {
    const before = evaluateIndicator(sleep, readings, ENVIRONMENTS.iss, now);
    expect(before.drift).toBeUndefined();
    expect(before.status).toBe(classify(6.4, sleep.thresholds));

    const withBaseline = evaluateIndicator(sleep, readings, ENVIRONMENTS.iss, now, { baseline: sleepBaseline });
    expect(withBaseline.drift).toBeDefined();
    expect(withBaseline.status).toBe('nominal'); // one night 2 SD below this person's usual
  });

  it('labels the basis as the individual baseline, never as a NASA limit', () => {
    for (const def of INDICATOR_LIST.filter((d) => usesIndividualBaseline(d.id))) {
      expect(provenanceOf(def.id).basis, def.id).toBe('rango_ilustrativo');
      const p = provenanceOf(def.id, true);
      expect(p.basis, def.id).toBe('baseline_individual');
      expect(p.nasaLimit, def.id).toBe(false);
      expect(p.basisLabel, def.id).toMatch(/not a NASA limit/);
      expect(p.evidence.provenanceClass, def.id).toBeTruthy();
      expect(p.source.title, def.id).toBeTruthy();
    }
  });
});

describe('verify against the baseline', () => {
  const treatedAt = at(15, 0.5);
  const intervention: Intervention = {
    id: 1, indicatorId: 'sleepHours', ruleId: 'R-SLEEP', stepText: 'Protect the next sleep period.', authorityLevel: 2,
    startedAt: treatedAt, valueBefore: 4, statusBefore: 'critical', outcome: 'pending', valueAfter: null, checkedAt: null,
  };
  const check = (later: number[], now: number) =>
    verifyIntervention(intervention, sleep, [...usualNights, ...daily('sleepHours', later, 14)], sleep.thresholds, now, sleepBaseline);

  it('gives the response three days', () => {
    expect(verificationWindowMin(sleep, true)).toBe(3 * DAY);
  });

  it('stays pending until a value is measured after the treatment', () => {
    expect(check([7.5, 4.0], at(15, 6)).outcome).toBe('pending');
  });

  it('is verified by a night back within the usual range', () => {
    expect(check([7.5, 4.0, 7.4], at(16, 1))).toEqual({ outcome: 'verified', valueAfter: 7.4, checkedAt: at(16) });
  });

  it('is not verified when three days pass and the nights are still short', () => {
    expect(check([7.5, 4.0, 5.0], at(16, 1)).outcome).toBe('pending');
    expect(check([7.5, 4.0, 5.0, 5.1, 5.0], treatedAt + 3 * DAY + 1)).toMatchObject({ outcome: 'not_verified', valueAfter: 5 });
  });
});
