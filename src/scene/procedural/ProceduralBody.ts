import * as THREE from 'three';
import type { SystemId } from '../../domain/types';
import type { BodyModel, SystemLayer, Vitals } from '../BodyModel';
import { buildCardiovascular } from './parts/cardiovascular';
import { buildDigestive } from './parts/digestive';
import { buildImmune } from './parts/immune';
import { buildMuscles } from './parts/muscles';
import { buildNeuro } from './parts/neuro';
import { buildRespiratory } from './parts/respiratory';
import { buildSensory } from './parts/sensory';
import { buildShell } from './parts/shell';
import { buildSkeleton } from './parts/skeleton';
import type { PartBuild } from './parts/types';

/** Which builder produces the geometry of each body system. */
const BUILDERS: Record<SystemId, () => PartBuild> = {
  radiation: buildShell,
  skeletal: buildSkeleton,
  muscular: buildMuscles,
  cardiovascular: buildCardiovascular,
  respiratory: buildRespiratory,
  neuro: buildNeuro,
  sensory: buildSensory,
  immune: buildImmune,
  metabolic: buildDigestive,
};

/**
 * A stylised human body generated entirely in code: no external model, no asset licences,
 * nothing to download. One group per body system, each with its own status materials.
 */
export class ProceduralBody implements BodyModel {
  readonly root = new THREE.Group();
  readonly layers: Map<SystemId, SystemLayer> = new Map();
  readonly pickables: THREE.Mesh[] = [];
  private animators: NonNullable<PartBuild['animate']>[] = [];

  constructor() {
    this.root.name = 'body';
    for (const [id, build] of Object.entries(BUILDERS) as [SystemId, () => PartBuild][]) {
      const part = build();
      const ghostMaterials = new Set(part.materials.filter((m) => m.kind === 'ghost').map((m) => m.material));
      part.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.userData.systemId = id;
        // Solid tissue first, translucent layers after, the outer shell last.
        // The same order decides what a click selects: you pick what you can actually see.
        object.renderOrder = id === 'radiation' ? 3 : ghostMaterials.has(object.material) ? 2 : 1;
        object.userData.pickRank = object.renderOrder;
        this.pickables.push(object);
      });
      this.layers.set(id, { id, group: part.group, materials: part.materials });
      if (part.animate) this.animators.push(part.animate);
      this.root.add(part.group);
    }
  }

  update(elapsed: number, vitals: Vitals): void {
    for (const animate of this.animators) animate(elapsed, vitals);
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const mesh of this.pickables) geometries.add(mesh.geometry);
    geometries.forEach((g) => g.dispose());
    for (const layer of this.layers.values()) layer.materials.forEach((m) => m.material.dispose());
  }
}
