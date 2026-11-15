import type { EnvironmentId } from '../domain/types';

/** Where the crew member lives during the mission, as offered on the welcome screen. */
export type HabitatId = 'spacecraft' | 'station' | 'rover' | 'lunar-base' | 'mars-base';

/** What the welcome flow learns about the crew member. Stored locally, never sent anywhere. */
export interface CrewProfile {
  name: string;
  /** Null when the crew member skipped the optional environment step. */
  habitat: HabitatId | null;
}

/** Each habitat runs on one of the engine's mission environments. */
export const HABITAT_ENVIRONMENT: Record<HabitatId, EnvironmentId> = {
  spacecraft: 'transit',
  station: 'iss',
  // A surface rover has no environment of its own in the engine yet: it uses the Mars surface values.
  rover: 'mars',
  'lunar-base': 'lunar',
  'mars-base': 'mars',
};

const STORAGE_KEY = 'helios.profile.v1';
const HABITATS = Object.keys(HABITAT_ENVIRONMENT);

/** The saved profile, or null on a first visit (or when storage is unavailable). */
export function loadProfile(): CrewProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CrewProfile>;
    if (typeof data.name !== 'string' || !data.name.trim()) return null;
    const habitat = typeof data.habitat === 'string' && HABITATS.includes(data.habitat) ? data.habitat : null;
    return { name: data.name.trim(), habitat };
  } catch {
    return null;
  }
}

export function saveProfile(profile: CrewProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode or blocked storage: the introduction simply shows again next time.
  }
}

export function environmentFor(profile: CrewProfile | null): EnvironmentId {
  return profile?.habitat ? HABITAT_ENVIRONMENT[profile.habitat] : 'iss';
}
