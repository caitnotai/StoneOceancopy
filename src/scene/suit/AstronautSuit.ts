import type * as THREE from 'three';

/**
 * The outer, friendly layer of the health twin: the crew member's suit. It is purely
 * visual. Nothing here can be selected and no health logic depends on it; the anatomy
 * underneath (`BodyModel`) stays the only thing the picker and the panels know about.
 *
 * Shares the body's frame: metres, feet at y = 0, facing +z.
 * `GltfSuit` loads public/models/astronaut.glb when that file exists; otherwise
 * `ProceduralSuit`, modelled in code, is the astronaut.
 */
export interface AstronautSuit {
  readonly root: THREE.Group;
  /** The suit's meshes, so a click on the astronaut can be recognised. */
  readonly pickables: THREE.Mesh[];
  /** 1 = the solid suit; lower values turn it into a see-through hologram; 0 hides it. */
  setOpacity(opacity: number): void;
  /** Overall health status, shown on the suit when it has somewhere to show it. */
  setStatusColor(color: THREE.Color): void;
  /** `breath` is -1..1; it is 0 when motion is reduced. */
  update(elapsed: number, breath: number): void;
  dispose(): void;
}
