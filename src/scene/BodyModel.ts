import type * as THREE from 'three';
import type { SystemId } from '../domain/types';
import type { StatusMaterial } from './materials';

/** Live values that animate the body (heartbeat follows the real heart rate). */
export interface Vitals {
  heartRateBpm: number;
  breathsPerMinute: number;
}

export interface SystemLayer {
  id: SystemId;
  group: THREE.Group;
  materials: StatusMaterial[];
}

/**
 * The contract between "a 3D body" and the rest of the app: one layer per body system.
 *
 * Frame shared by every implementation: metres, feet at y = 0, about 1.76 tall, facing +z,
 * the body's left side at +x. Two implementations exist:
 *  - `GltfBody`: the anatomical model built from the BodyParts3D atlas (the default);
 *  - `ProceduralBody`: a stylised figure generated in code, used if the model cannot load.
 * The scene, the picker and the UI only ever see this interface.
 */
export interface BodyModel {
  readonly root: THREE.Group;
  readonly layers: ReadonlyMap<SystemId, SystemLayer>;
  /** Every mesh that can be clicked; each carries `userData.systemId` and `userData.pickRank`. */
  readonly pickables: THREE.Mesh[];
  update(elapsed: number, vitals: Vitals): void;
  dispose(): void;
}
