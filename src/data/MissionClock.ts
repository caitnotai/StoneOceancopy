import type { MissionMinutes } from '../domain/types';

export const MINUTES_PER_DAY = 1440;

export interface ClockSpeed {
  label: string;
  /** Mission minutes that pass per real second. 0 = paused. */
  minutesPerSecond: number;
}

export const CLOCK_SPEEDS: ClockSpeed[] = [
  { label: 'Pause', minutesPerSecond: 0 },
  { label: '10 min/s', minutesPerSecond: 10 },
  { label: '1 h/s', minutesPerSecond: 60 },
  { label: '6 h/s', minutesPerSecond: 360 },
];

type TickListener = (now: MissionMinutes, previous: MissionMinutes) => void;

/**
 * Mission time. In flight this would simply follow the spacecraft clock; for the demo it can
 * run faster than real time so that days of physiological drift fit in a few seconds.
 */
export class MissionClock {
  private timer: number | null = null;
  private lastReal = 0;
  private listeners = new Set<TickListener>();
  private minutesPerSecond = 60;

  constructor(public now: MissionMinutes) {}

  get speed(): number {
    return this.minutesPerSecond;
  }

  setSpeed(minutesPerSecond: number): void {
    this.minutesPerSecond = minutesPerSecond;
  }

  onTick(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(intervalMs = 200): void {
    if (this.timer !== null) return;
    this.lastReal = performance.now();
    this.timer = window.setInterval(() => {
      const real = performance.now();
      // Cap the step so a backgrounded tab does not jump weeks ahead on return.
      const dtSec = Math.min((real - this.lastReal) / 1000, 1);
      this.lastReal = real;
      if (this.minutesPerSecond <= 0) return;
      const previous = this.now;
      this.now = previous + dtSec * this.minutesPerSecond;
      this.listeners.forEach((l) => l(this.now, previous));
    }, intervalMs);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}

export function formatMissionTime(t: MissionMinutes): { day: number; clock: string } {
  const day = Math.floor(t / MINUTES_PER_DAY) + 1;
  const minuteOfDay = Math.floor(((t % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');
  return { day, clock: `${hh}:${mm}` };
}
