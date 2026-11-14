import { describe, expect, it } from 'vitest';
import { handle, type ApiResponse } from '../src/api/handlers';
import { CREW_ID, MissionRuntime } from '../src/api/runtime';
import { PROVENANCE_CLASSES } from '../src/domain/evidence/types';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const get = (runtime: MissionRuntime, path: string, query?: Record<string, string>): ApiResponse & { body: Json } =>
  handle(runtime, { method: 'GET', path, query }) as ApiResponse & { body: Json };
const send = (runtime: MissionRuntime, method: string, path: string, body?: unknown): ApiResponse & { body: Json } =>
  handle(runtime, { method, path, body }) as ApiResponse & { body: Json };

describe('API: rules and evidence', () => {
  const runtime = new MissionRuntime();

  it('lists its endpoints', () => {
    const { status, body } = get(runtime, '/');
    expect(status).toBe(200);
    expect(body.endpoints.join(' ')).toMatch(/\/rules.*\/evidence.*\/state.*\/radiation\/now.*\/alerts.*\/verify/);
  });

  it('GET /rules returns the matrix, filterable by hazard', () => {
    expect(get(runtime, '/rules').body.count).toBe(11);
    const gravity = get(runtime, '/rules', { hazard: 'gravity' }).body.rules;
    expect(gravity.map((r: Json) => r.id).sort()).toEqual(['R-BONE', 'R-MUSCLE', 'R-ORTHO', 'R-SANS']);
  });

  it('GET /rules/{id} returns the rule with its evidence, and 404 for an unknown id', () => {
    const { body } = get(runtime, '/rules/R-CO2');
    expect(body.rule.detect.nasaLimit).toBe(true);
    expect(body.evidence.map((e: Json) => e.id)).toContain('E-CO2-STANDARD');
    expect(get(runtime, '/rules/R-NOPE').status).toBe(404);
  });

  it('GET /evidence gives every claim its provenance class, sample size and source', () => {
    const { body } = get(runtime, '/evidence');
    expect(body.count).toBe(35);
    for (const e of body.evidence) {
      expect(PROVENANCE_CLASSES).toContain(e.provenance_class);
      expect(e).toHaveProperty('n');
      expect(e).toHaveProperty('ci95');
      expect(e.source.id).toBeTruthy();
      expect(['verificado', 'fuente_localizada', 'sin_verificar']).toContain(e.verification);
    }
  });

  it('GET /evidence filters by rule and by provenance class, and rejects an unknown class', () => {
    expect(get(runtime, '/evidence', { rule: 'R-CO2' }).body.evidence.every((e: Json) => e.ruleIds.includes('R-CO2'))).toBe(true);
    const simulated = get(runtime, '/evidence', { provenance_class: 'IMM_simulado' }).body.evidence;
    expect(simulated.length).toBeGreaterThan(0);
    expect(simulated.every((e: Json) => e.provenance_class === 'IMM_simulado')).toBe(true);
    expect(get(runtime, '/evidence', { provenance_class: 'made_up' }).status).toBe(400);
  });
});

describe('API: state, alerts and radiation', () => {
  it('GET /state/{crew_id} describes a healthy crew member at the start', () => {
    const runtime = new MissionRuntime();
    const { status, body } = get(runtime, `/state/${CREW_ID}`);
    expect(status).toBe(200);
    expect(body.missionDay).toBe(45);
    expect(body.triage.level).toBe('nominal');
    expect(body.systems).toHaveLength(9);
    expect(body.systems.every((s: Json) => s.status === 'nominal')).toBe(true);
    expect(body.medicalPlan.drugsPreauthorized).toBe(false);
    expect(get(runtime, '/state/someone-else').status).toBe(404);
  });

  it('marks which thresholds are NASA limits in the state', () => {
    const runtime = new MissionRuntime();
    const indicators = get(runtime, `/state/${CREW_ID}`).body.systems.flatMap((s: Json) => s.indicators);
    expect(indicators.filter((i: Json) => i.nasaLimit).map((i: Json) => i.id).sort()).toEqual(['ppCO2', 'retinalThickness']);
  });

  it('GET /alerts is empty at baseline and never returns an alert without provenance and source', () => {
    const runtime = new MissionRuntime();
    expect(get(runtime, '/alerts').body.count).toBe(0);
    for (const scenario of ['co2-fault', 'infection', 'exercise-gap', 'solar-event', 'sans']) {
      const mission = new MissionRuntime();
      send(mission, 'POST', '/simulate', { scenario, hours: scenario === 'solar-event' ? 6 : 96 });
      const { alerts } = get(mission, '/alerts').body;
      expect(alerts.length, scenario).toBeGreaterThan(0);
      for (const alert of alerts) {
        expect(PROVENANCE_CLASSES, `${scenario}: ${alert.indicatorId}`).toContain(alert.provenance_class);
        expect(alert.source.id, alert.indicatorId).toBeTruthy();
        expect(alert.source.url, alert.indicatorId).toMatch(/^https:\/\//);
        expect(alert.ruleId, alert.indicatorId).toMatch(/^R-/);
        expect(alert.verify.length, alert.indicatorId).toBeGreaterThan(10);
        if (!alert.nasaLimit) expect(alert.basisLabel, alert.indicatorId).toMatch(/not a NASA limit/);
      }
    }
  });

  it('withholds medication steps in alerts until the medical plan pre-authorizes drugs', () => {
    const runtime = new MissionRuntime();
    send(runtime, 'POST', '/simulate', { scenario: 'infection', hours: 96 });
    const fever = () => get(runtime, '/alerts').body.alerts.find((a: Json) => a.indicatorId === 'bodyTemp');
    expect(fever().treat.firstSteps.some((s: Json) => s.withheld)).toBe(true);
    expect(fever().treat.protocol.filter((s: Json) => s.authorityLevel === 3).every((s: Json) => s.withheld)).toBe(true);
    expect(send(runtime, 'PUT', '/medical-plan', { drugsPreauthorized: true }).status).toBe(200);
    expect(fever().treat.firstSteps.some((s: Json) => s.withheld)).toBe(false);
  });

  it('GET /radiation/now reports real space weather from the offline snapshot', () => {
    const { body } = get(new MissionRuntime(), '/radiation/now');
    expect(body.origin).toBe('snapshot');
    expect(body.latest.protonFluxPfu).toBeGreaterThan(0);
    expect(body.noaaScale).toMatchObject({ level: 0, name: 'none', s1ThresholdPfu: 10, nasaLimit: false });
    expect(body.eventInProgress).toBe(false);
    expect(body.solarParticleEventsOnRecord.count).toBeGreaterThan(0);
  });
});

describe('API: treat and verify', () => {
  it('runs the whole loop for a CO2 fault', () => {
    const runtime = new MissionRuntime();
    send(runtime, 'POST', '/simulate', { scenario: 'co2-fault', hours: 12 });
    const alert = get(runtime, '/alerts').body.alerts.find((a: Json) => a.indicatorId === 'ppCO2');
    expect(alert).toMatchObject({ status: 'caution', nasaLimit: true, provenance_class: 'estandar_obligatorio', ruleId: 'R-CO2' });

    const step = alert.treat.protocol[0];
    const started = send(runtime, 'POST', '/verify', { indicatorId: 'ppCO2', stepText: step.text, authorityLevel: step.authorityLevel, simulateEffect: true });
    expect(started.status).toBe(201);
    expect(started.body.intervention.outcome).toBe('pending');

    send(runtime, 'POST', '/simulate', { hours: 12 });
    const [intervention] = get(runtime, '/verify').body.interventions;
    expect(intervention.outcome).toBe('verified');
    expect(intervention.valueAfter).toBeLessThanOrEqual(3);
    expect(get(runtime, '/alerts').body.alerts.some((a: Json) => a.indicatorId === 'ppCO2')).toBe(false);
  });

  it('refuses a medication step while drugs are not pre-authorized', () => {
    const runtime = new MissionRuntime();
    const drug = { indicatorId: 'bodyTemp', stepText: 'Take a fever reducer following the onboard procedure.', authorityLevel: 3 };
    expect(send(runtime, 'POST', '/verify', drug).status).toBe(403);
    // Calling it level 2 does not get a drug past the gate.
    expect(send(runtime, 'POST', '/verify', { ...drug, authorityLevel: 2 }).status).toBe(403);
    send(runtime, 'PUT', '/medical-plan', { drugsPreauthorized: true });
    expect(send(runtime, 'POST', '/verify', drug).status).toBe(201);
  });

  it('validates what it is sent', () => {
    const runtime = new MissionRuntime();
    expect(send(runtime, 'POST', '/verify', { indicatorId: 'nope', stepText: 'x', authorityLevel: 1 }).status).toBe(400);
    expect(send(runtime, 'POST', '/verify', { indicatorId: 'ppCO2', stepText: '', authorityLevel: 1 }).status).toBe(400);
    expect(send(runtime, 'POST', '/verify', { indicatorId: 'ppCO2', stepText: 'x', authorityLevel: 7 }).status).toBe(400);
    expect(send(runtime, 'POST', '/measurements', { indicatorId: 'mood', value: 'low' }).status).toBe(400);
    expect(send(runtime, 'POST', '/measurements', { indicatorId: 'mood', value: 99 }).status).toBe(400);
    expect(send(runtime, 'POST', '/simulate', { hours: -3 }).status).toBe(400);
    expect(send(runtime, 'POST', '/simulate', { scenario: 'made-up' }).status).toBe(400);
    expect(send(runtime, 'PUT', '/medical-plan', { drugsPreauthorized: 'yes' }).status).toBe(400);
    expect(send(runtime, 'DELETE', '/rules').status).toBe(404);
  });

  it('accepts a manual measurement and reflects it in the state', () => {
    const runtime = new MissionRuntime();
    // Mood is judged against this person's own baseline (about 7.7): 3 is far below it, 1 is extreme.
    expect(send(runtime, 'POST', '/measurements', { indicatorId: 'mood', value: 3 }).status).toBe(201);
    const neuroAfter = (): Json => get(runtime, `/state/${CREW_ID}`).body.systems.find((s: Json) => s.id === 'neuro');
    expect(neuroAfter().status).not.toBe('nominal');
    expect(neuroAfter().indicators.find((i: Json) => i.id === 'mood').value).toBe(3);
    expect(send(runtime, 'POST', '/measurements', { indicatorId: 'mood', value: 1 }).status).toBe(201);
    expect(neuroAfter().status).toBe('critical');
  });

  it('reports the individual baseline behind every indicator judged against it', () => {
    const runtime = new MissionRuntime();
    const indicators: Json[] = get(runtime, `/state/${CREW_ID}`).body.systems.flatMap((s: Json) => s.indicators);
    const heart = indicators.find((i) => i.id === 'heartRate')!;
    expect(heart).toMatchObject({ thresholdBasis: 'baseline_individual', nasaLimit: false });
    expect(heart.baseline).toMatchObject({ days: 14, adverseDirection: 'both', trigger: null, awaitingFirstValue: false });
    expect(heart.baseline.usualRange.min).toBeLessThan(heart.baseline.mean);
    expect(heart.baseline.rules.singleValue.cautionLimit).toBeGreaterThan(4);
    // An open end of a range is null, never a number JSON cannot carry.
    expect(indicators.find((i) => i.id === 'sleepHours')!.baseline.usualRange.max).toBeNull();
    // The two NASA limits keep their own basis and have no baseline.
    expect(indicators.find((i) => i.id === 'ppCO2')).toMatchObject({ thresholdBasis: 'estandar_obligatorio', nasaLimit: true, baseline: null });
    expect(indicators.find((i) => i.id === 'retinalThickness')).toMatchObject({ thresholdBasis: 'criterio_clinico_NASA', baseline: null });

    send(runtime, 'POST', '/measurements', { indicatorId: 'mood', value: 1 });
    const alert = get(runtime, '/alerts').body.alerts.find((a: Json) => a.indicatorId === 'mood');
    expect(alert).toMatchObject({ thresholdBasis: 'baseline_individual', nasaLimit: false });
    expect(alert.basisLabel).toMatch(/Individual baseline · not a NASA limit/);
    expect(alert.baseline.trigger).toBe('single_value');
    expect(alert.provenance_class).toBeTruthy();
    expect(alert.source.title).toBeTruthy();
  });
});
