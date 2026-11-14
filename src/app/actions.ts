import type { IndicatorId } from '../domain/types';

/** Everything the UI is allowed to ask the application to do. */
export interface AppActions {
  logReading(id: IndicatorId, value: number): void;
  setScenario(id: string): void;
  setSpeed(minutesPerSecond: number): void;
  setAutoLog(enabled: boolean): void;
  resetMission(): void;
}
