import type { ReadingSink } from '../HealthStore';

/**
 * A source of readings: a simulator today; a BLE wearable, a dosimeter feed or the phone's
 * accelerometer tomorrow. Sources only know the sink, never the UI or the 3D scene, so
 * swapping simulated data for real hardware does not touch anything else.
 */
export interface SensorSource {
  readonly id: string;
  connect(sink: ReadingSink): void;
  disconnect(): void;
}
