import type { IndicatorId } from '../../domain/types';

export interface ScenarioEffect {
  /** Value the indicator drifts toward while the scenario is active. */
  target: number;
  /** Time constant of the drift, in hours. Defaults to the channel's own. */
  tauHours?: number;
}

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  effects: Partial<Record<IndicatorId, ScenarioEffect>>;
  /** Extra radiation dose delivered over a period, on top of the environment's rate. */
  radiationBurst?: { totalMSv: number; hours: number };
}

/**
 * Demo scenarios. Each one models how a spaceflight hazard shows up in the indicators,
 * so the audience can watch a body system change color and the guidance react.
 */
export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'nominal',
    name: 'Nominal mission',
    description: 'Healthy crew member following the daily routine.',
    effects: {},
  },
  {
    id: 'exercise-gap',
    name: 'Exercise device failure',
    description: 'The resistive device is down: bone and muscle loading falls day after day.',
    effects: {
      resistiveExercise: { target: 6 },
      aerobicExercise: { target: 8, tauHours: 48 },
    },
  },
  {
    id: 'sleep-loss',
    name: 'Sleep disruption',
    description: 'Shifted schedule and high workload cut sleep; mood and heart rate follow.',
    effects: {
      sleepHours: { target: 4.4, tauHours: 20 },
      mood: { target: 4.6, tauHours: 40 },
      heartRate: { target: 76 },
      dizziness: { target: 2.4 },
    },
  },
  {
    id: 'infection',
    name: 'Viral reactivation',
    description: 'A dormant virus reactivates: fever first, then heart rate and oxygen saturation.',
    effects: {
      bodyTemp: { target: 38.7, tauHours: 10 },
      heartRate: { target: 98, tauHours: 10 },
      spo2: { target: 94.2, tauHours: 12 },
      mood: { target: 5.4 },
      calorieIntake: { target: 80 },
    },
  },
  {
    id: 'sans',
    name: 'Fluid shift (SANS signs)',
    description: 'Headward fluid shift: retinal thickness passes the NASA SANS criteria (20 µm, then 55 µm).',
    effects: {
      retinalThickness: { target: 64, tauHours: 60 },
      visionChange: { target: 5.8, tauHours: 60 },
      dizziness: { target: 3.4, tauHours: 30 },
    },
  },
  {
    id: 'solar-event',
    name: 'Solar particle event',
    description: 'Simulated solar storm: proton flux climbs to NOAA level S3 for 8 hours. Flux and dose magnitudes are simulation parameters, not observations.',
    effects: { protonFlux: { target: 1800, tauHours: 3 }, mood: { target: 6.2 } },
    radiationBurst: { totalMSv: 320, hours: 8 },
  },
  {
    id: 'co2-fault',
    name: 'CO₂ removal fault',
    description: 'A scrubber underperforms: the one-hour CO₂ average climbs past the 3 mmHg NASA standard.',
    effects: { ppCO2: { target: 4.4, tauHours: 4 } },
  },
  {
    id: 'under-eating',
    name: 'Under-eating',
    description: 'Appetite drops and intake falls well below the energy requirement.',
    effects: {
      calorieIntake: { target: 68, tauHours: 30 },
      glucose: { target: 63, tauHours: 30 },
      mood: { target: 6.3 },
    },
  },
];

export const scenarioById = (id: string): ScenarioDef => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
