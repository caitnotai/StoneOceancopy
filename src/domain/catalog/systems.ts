import type { HazardId, ResourceLink, SystemDef, SystemId } from '../types';

const HRP_RISKS = 'https://www.nasa.gov/hrp/risks/';
const risk = (name: string): ResourceLink => ({ name, url: HRP_RISKS });

export const HAZARDS: Record<HazardId, { name: string; url: string }> = {
  radiation: { name: 'Space radiation', url: 'https://www.nasa.gov/hrp/hazards/' },
  isolation: { name: 'Isolation & confinement', url: 'https://www.nasa.gov/hrp/hazards/' },
  distance: { name: 'Distance from Earth', url: 'https://www.nasa.gov/hrp/hazards/' },
  gravity: { name: 'Gravity fields', url: 'https://www.nasa.gov/hrp/hazards/' },
  environment: { name: 'Hostile closed environment', url: 'https://www.nasa.gov/hrp/hazards/' },
};

/**
 * The body, as data: one entry per system. Each one links to the NASA Human Research
 * Program (HRP) risk it tracks, so every color on the 3D body has a stated reason.
 */
export const SYSTEMS: Record<SystemId, SystemDef> = {
  cardiovascular: {
    id: 'cardiovascular',
    name: 'Cardiovascular',
    role: 'Heart and blood vessels: moves oxygen and nutrients to every tissue.',
    spaceflightEffect:
      'Without gravity, blood and fluids shift toward the head and the heart works against less load. Over months this changes how the heart and vessels behave and can raise the chance of cardiovascular events.',
    hazards: ['gravity', 'radiation'],
    risks: [risk('Risk of Cardiovascular Adaptations')],
  },
  skeletal: {
    id: 'skeletal',
    name: 'Skeletal',
    role: 'Bones: structure, protection and the body’s mineral reserve.',
    spaceflightEffect:
      'Unloaded bones break down faster than they rebuild. Weight-bearing bones can lose around 1–1.5% of their mineral density per month in microgravity, so resistive exercise is the main countermeasure.',
    hazards: ['gravity'],
    risks: [risk('Risk of Spaceflight-Induced Bone Changes')],
  },
  muscular: {
    id: 'muscular',
    name: 'Muscular',
    role: 'Skeletal muscle: movement, posture and physical work capacity.',
    spaceflightEffect:
      'Muscles that no longer fight gravity lose mass and strength quickly. Station crews exercise about two hours a day to stay fit enough for spacewalks and for landing.',
    hazards: ['gravity'],
    risks: [risk('Risk of Reduced Cardiorespiratory and Musculoskeletal Fitness')],
  },
  respiratory: {
    id: 'respiratory',
    name: 'Respiratory',
    role: 'Lungs and airways: gas exchange with the cabin atmosphere.',
    spaceflightEffect:
      'The crew breathes a sealed, recycled atmosphere. Cabin pressure and oxygen changes around spacewalks can lead to mild hypoxia or decompression sickness.',
    hazards: ['environment'],
    risks: [risk('Risk of Hypoxia'), risk('Risk of Decompression Sickness')],
  },
  neuro: {
    id: 'neuro',
    name: 'Brain & behavior',
    role: 'Brain: mood, cognition, sleep and decision making.',
    spaceflightEffect:
      'Isolation, confinement, heavy workload and a disrupted day–night cycle wear down sleep and mood, which in turn degrade performance and teamwork.',
    hazards: ['isolation', 'distance'],
    risks: [
      risk('Risk of Behavioral Changes and Psychiatric Disorders'),
      risk('Risk of Inadequate Sleep and Irregular Schedules'),
    ],
  },
  sensory: {
    id: 'sensory',
    name: 'Eyes & balance',
    role: 'Eyes and inner ear: vision, orientation and coordination.',
    spaceflightEffect:
      'The headward fluid shift can change the structure of the eye and optic nerve (SANS). The inner ear also has to relearn orientation at every gravity transition, causing motion sickness and dizziness.',
    hazards: ['gravity'],
    risks: [
      risk('Risk of Spaceflight Associated Neuro-ocular Syndrome (SANS)'),
      risk('Risk of Altered Sensorimotor and Vestibular Function'),
    ],
  },
  immune: {
    id: 'immune',
    name: 'Immune',
    role: 'Lymph nodes, spleen and thymus: defense against infection.',
    spaceflightEffect:
      'Spaceflight stress alters immune responses and can reactivate dormant viruses, causing rashes and other symptoms. In a closed habitat, microbes are shared by the whole crew.',
    hazards: ['isolation', 'environment', 'radiation'],
    risks: [risk('Risk of Altered Immune System Responses'), risk('Risk of Host-Microorganism Interactions')],
  },
  metabolic: {
    id: 'metabolic',
    name: 'Digestive & metabolic',
    role: 'Stomach, liver and gut: turns food into energy and building material.',
    spaceflightEffect:
      'Crews often eat less than they need, and stored food loses nutrients over long missions. Inadequate nutrition weakens every other system and its countermeasures.',
    hazards: ['distance', 'environment'],
    risks: [risk('Risk of Inadequate Food and Nutrition')],
  },
  radiation: {
    id: 'radiation',
    name: 'Radiation exposure',
    role: 'Whole body: cumulative dose absorbed during the mission.',
    spaceflightEffect:
      'Beyond Earth’s magnetic shield the crew is exposed to galactic cosmic rays and solar particle events. Dose adds up over the mission and raises lifetime cancer risk.',
    hazards: ['radiation'],
    risks: [
      risk('Risk of Radiation-Induced Cancers'),
      {
        name: 'CSA: Monitoring radiation for astronaut health',
        url: 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp',
      },
    ],
  },
};

export const SYSTEM_LIST: SystemDef[] = Object.values(SYSTEMS);
