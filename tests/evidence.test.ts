import { describe, expect, it } from 'vitest';
import { INDICATORS } from '../src/domain/catalog/indicators';
import { HAZARDS, SYSTEMS } from '../src/domain/catalog/systems';
import { EVIDENCE, evidenceFor, primaryEvidence, RULES, rulesForSystem, SOURCES, verificationOf } from '../src/domain/evidence/catalog';
import { DETECT_KINDS, PROVENANCE_CLASSES, VERIFICATION_STATUSES } from '../src/domain/evidence/types';

describe('rules matrix', () => {
  it('has the ten conditions of the research report, with unique ids', () => {
    expect(RULES.filter((r) => r.origin !== 'project')).toHaveLength(10);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it('marks the one rule the project added, so it is never mistaken for the report', () => {
    const added = RULES.filter((r) => r.origin === 'project');
    expect(added.map((r) => r.id)).toEqual(['R-NUTRITION']);
    expect(added[0].detect.nasaLimit).toBe(false);
    expect(added[0].cautions.join(' ')).toMatch(/not part of the research report/);
  });

  it('covers the five HRP hazards', () => {
    expect(new Set(RULES.map((r) => r.hazard))).toEqual(new Set(Object.keys(HAZARDS)));
  });

  it('only refers to body systems and indicators that exist', () => {
    for (const rule of RULES) {
      expect(DETECT_KINDS, rule.id).toContain(rule.detect.kind);
      if (rule.systemId !== null) expect(SYSTEMS[rule.systemId], rule.id).toBeDefined();
      for (const id of rule.indicatorIds) expect(INDICATORS[id], `${rule.id}: ${id}`).toBeDefined();
    }
  });

  it('gives every rule the three steps: detect, treat and verify', () => {
    for (const rule of RULES) {
      expect(rule.detect.criterion.length, rule.id).toBeGreaterThan(20);
      expect(rule.treat.length, rule.id).toBeGreaterThan(0);
      expect(rule.verify.criterion.length, rule.id).toBeGreaterThan(20);
      expect(rule.verify.metrics.length, rule.id).toBeGreaterThan(0);
    }
  });
});

describe('NASA limits', () => {
  it('are claimed only by the CO2 standard and the SANS clinical criteria', () => {
    const claimed = RULES.filter((r) => r.detect.nasaLimit).map((r) => r.id).sort();
    expect(claimed).toEqual(['R-CO2', 'R-SANS']);
  });

  it('are always backed by a standard or a NASA clinical criterion', () => {
    for (const rule of RULES.filter((r) => r.detect.nasaLimit)) {
      expect(['estandar_obligatorio', 'criterio_clinico_NASA'], rule.id).toContain(rule.detect.kind);
      expect(primaryEvidence(rule)?.provenanceClass, rule.id).toBe(rule.detect.kind);
    }
  });

  it('are never implied by the label of any other rule', () => {
    for (const rule of RULES.filter((r) => !r.detect.nasaLimit)) {
      expect(rule.detect.label, rule.id).toMatch(/not a NASA/i);
      expect(rule.detect.limits, rule.id).toBeUndefined();
    }
  });

  it('keep the report values: ppCO2 3 mmHg; retinal thickness 20 and 55 um', () => {
    expect(RULES.find((r) => r.id === 'R-CO2')?.detect.limits).toEqual({ metric: 'ppCO2', caution: 3 });
    expect(RULES.find((r) => r.id === 'R-SANS')?.detect.limits).toEqual({ metric: 'retinalThickness', caution: 20, critical: 55 });
  });
});

describe('treatment authority', () => {
  it('uses the four authority levels of the report', () => {
    const levels = new Set(RULES.flatMap((r) => r.treat.map((t) => t.authorityLevel)));
    expect([...levels].sort()).toEqual([1, 2, 3, 4]);
  });

  it('puts every drug step at level 3 behind the pre-authorization flag', () => {
    const drug = /medication|analges|antiviral|bisphosphonate|drug/i;
    for (const rule of RULES) {
      for (const step of rule.treat) {
        if (step.authorityLevel === 3) expect(step.requiresPreauthorization, `${rule.id}: ${step.text}`).toBe(true);
        if (drug.test(step.text)) expect(step.authorityLevel, `${rule.id}: ${step.text}`).toBe(3);
        if (step.requiresPreauthorization) expect(step.authorityLevel, `${rule.id}: ${step.text}`).toBe(3);
      }
    }
  });
});

describe('evidence provenance', () => {
  it('gives every evidence row a provenance class, an effect and a located source', () => {
    for (const e of EVIDENCE) {
      expect(PROVENANCE_CLASSES, e.id).toContain(e.provenanceClass);
      expect(e.effect.length, e.id).toBeGreaterThan(0);
      expect(e.claim.length, e.id).toBeGreaterThan(20);
      expect(e.limitations.length, e.id).toBeGreaterThan(0);
      const source = SOURCES.find((s) => s.id === e.sourceId);
      expect(source, `${e.id} -> ${e.sourceId}`).toBeDefined();
      expect(source?.url, `${e.id} has no URL`).toMatch(/^https:\/\//);
      expect(VERIFICATION_STATUSES, e.id).toContain(verificationOf(e.id));
    }
  });

  it('states the sample size or says why there is none', () => {
    for (const e of EVIDENCE) {
      if (e.n === null) expect(e.nNote, e.id).toBeTruthy();
      else expect(e.n, e.id).toBeGreaterThan(0);
      if (e.ci95) expect(e.ci95[0], e.id).toBeLessThan(e.ci95[1]);
    }
  });

  it('keeps no invalid citation marker as a source', () => {
    for (const s of SOURCES) expect(`${s.url} ${s.doi}`, s.id).not.toMatch(/cite|turn\d+/);
  });

  it('backs every rule with evidence, and every evidence row belongs to a rule', () => {
    for (const rule of RULES) {
      expect(evidenceFor(rule).length, rule.id).toBe(rule.evidenceIds.length);
      expect(primaryEvidence(rule), rule.id).toBeDefined();
    }
    const used = new Set(RULES.flatMap((r) => r.evidenceIds));
    for (const e of EVIDENCE) expect(used.has(e.id), e.id).toBe(true);
  });

  it('never presents simulated event counts as observed prevalence', () => {
    const events = EVIDENCE.find((e) => e.id === 'E-MED-IMM')!;
    expect(events.provenanceClass).toBe('IMM_simulado');
    // Expected events per simulated mission are counts: no percentage may appear.
    expect(`${events.claim} ${events.effect}`).not.toMatch(/%/);
    expect(events.limitations).toMatch(/not observed prevalence/i);
    for (const e of EVIDENCE.filter((x) => x.provenanceClass === 'IMM_simulado')) {
      expect(e.nNote, e.id).toMatch(/simulation|model/i);
    }
  });

  it('finds the rules of a body system', () => {
    expect(rulesForSystem('respiratory').map((r) => r.id)).toEqual(['R-CO2']);
    expect(rulesForSystem('immune').map((r) => r.id).sort()).toEqual(['R-IMMUNE', 'R-MINOR']);
  });
});
