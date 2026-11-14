import { describe, expect, it } from 'vitest';
import { INDICATOR_LIST, INDICATORS } from '../src/domain/catalog/indicators';
import { classify } from '../src/domain/engine/evaluate';
import { RULES } from '../src/domain/evidence/catalog';
import { INDICATOR_RULES, isNasaLimit, provenanceOf, THRESHOLD_BASES } from '../src/domain/evidence/indicatorRules';
import { PROVENANCE_CLASSES } from '../src/domain/evidence/types';
import { doseMargin, doseThresholds, MISSION_DOSE_BUDGET_MSV } from '../src/domain/radiation/budget';
import { detectSpe, sScale } from '../src/domain/radiation/spe';
import type { Reading } from '../src/domain/types';

describe('alert provenance', () => {
  it('gives every indicator a rule, a provenance class and a source that opens', () => {
    for (const def of INDICATOR_LIST) {
      const p = provenanceOf(def.id);
      expect(THRESHOLD_BASES, def.id).toContain(p.basis);
      expect(PROVENANCE_CLASSES, def.id).toContain(p.evidence.provenanceClass);
      expect(p.source.url, def.id).toMatch(/^https:\/\//);
      expect(p.evidence.source.url, def.id).toMatch(/^https:\/\//);
    }
  });

  it('labels a threshold as a NASA limit only for cabin CO2 and retinal thickness', () => {
    const nasa = INDICATOR_LIST.filter((d) => provenanceOf(d.id).nasaLimit).map((d) => d.id).sort();
    expect(nasa).toEqual(['ppCO2', 'retinalThickness']);
    for (const def of INDICATOR_LIST) {
      const p = provenanceOf(def.id);
      if (!p.nasaLimit) expect(p.basisLabel, def.id).toMatch(/not a NASA limit/);
      // An indicator may only claim a NASA limit if its rule does.
      if (p.nasaLimit) expect(p.rule.detect.nasaLimit, def.id).toBe(true);
      expect(isNasaLimit(p.basis)).toBe(p.nasaLimit);
    }
  });

  it('never mentions NASA as the origin of an illustrative range', () => {
    for (const def of INDICATOR_LIST) {
      if (INDICATOR_RULES[def.id].basis !== 'rango_ilustrativo') continue;
      const claimsNasa = /NASA/.test(def.reference) && !/not a NASA limit|NASA publishes no/i.test(def.reference);
      expect(claimsNasa, `${def.id}: ${def.reference}`).toBe(false);
    }
  });

  it('links indicators and rules both ways', () => {
    for (const rule of RULES) {
      for (const id of rule.indicatorIds) expect(INDICATOR_RULES[id].ruleId, `${rule.id} -> ${id}`).toBe(rule.id);
    }
    for (const def of INDICATOR_LIST) {
      const rule = RULES.find((r) => r.id === INDICATOR_RULES[def.id].ruleId);
      expect(rule?.indicatorIds, def.id).toContain(def.id);
    }
  });
});

describe('official limits', () => {
  it('ppCO2: 3.0 mmHg is within the standard, 3.1 is not, and nothing is critical without a program limit', () => {
    const th = INDICATORS.ppCO2.thresholds;
    expect(classify(2.4, th)).toBe('nominal');
    expect(classify(3.0, th)).toBe('nominal');
    expect(classify(3.1, th)).toBe('caution');
    expect(classify(7.5, th)).toBe('caution');
  });

  it('retinal thickness: 20 um is an early indication and 55 um is clinically concerning', () => {
    const th = INDICATORS.retinalThickness.thresholds;
    expect(classify(-4, th)).toBe('nominal');
    expect(classify(19, th)).toBe('nominal');
    expect(classify(20, th)).toBe('caution');
    expect(classify(54, th)).toBe('caution');
    expect(classify(55, th)).toBe('critical');
  });
});

describe('radiation', () => {
  it('has no mission budget by default, so cumulative dose is tracked and never judged', () => {
    expect(MISSION_DOSE_BUDGET_MSV).toBeNull();
    const th = doseThresholds(null);
    expect(classify(50, th)).toBe('nominal');
    expect(classify(5_000, th)).toBe('nominal');
    expect(doseMargin(120, null)).toBeNull();
  });

  it('with a budget: acceptable up to it and critical beyond, with no invented band in between', () => {
    const th = doseThresholds(150);
    expect(classify(149, th)).toBe('nominal');
    expect(classify(150, th)).toBe('nominal');
    expect(classify(151, th)).toBe('critical');
    expect(doseMargin(120, 150)).toBe(30);
  });

  it('maps proton flux to the NOAA S-scale', () => {
    expect([0.3, 9.9, 10, 99, 100, 999, 1_000, 10_000, 100_000].map(sScale)).toEqual([0, 0, 1, 1, 2, 2, 3, 4, 5]);
  });

  it('classifies flux with the same scale: S1 and S2 caution, S3 and above critical', () => {
    const th = INDICATORS.protonFlux.thresholds;
    expect(classify(0.3, th)).toBe('nominal');
    expect(classify(9.9, th)).toBe('nominal');
    expect(classify(10, th)).toBe('caution');
    expect(classify(999.9, th)).toBe('caution');
    expect(classify(1_000, th)).toBe('critical');
  });

  it('needs a sustained rise to declare a solar particle event', () => {
    const series = (values: number[]): Reading[] => values.map((value, i) => ({ indicatorId: 'protonFlux', value, t: i * 5, source: 'sensor' }));
    expect(detectSpe(series([0.3, 0.4, 250, 0.3, 0.4])).inProgress).toBe(false); // a single spike is a glitch
    expect(detectSpe(series([0.3, 12, 40])).inProgress).toBe(false); // not sustained yet
    const event = detectSpe(series([0.3, 12, 40, 180, 1_400, 600]));
    expect(event).toMatchObject({ inProgress: true, level: 3, peakPfu: 1_400, startedAt: 5 });
    expect(detectSpe(series([12, 40, 180, 1_400, 600, 4, 0.5])).inProgress).toBe(false); // over
  });
});
