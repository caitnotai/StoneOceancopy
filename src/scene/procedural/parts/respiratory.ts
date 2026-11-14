import * as THREE from 'three';
import { breath } from '../../animation';
import { createSolidMaterial } from '../../materials';
import { bothSides, ellipsoid, tube, v } from '../geometry';
import { groupOf, type PartBuild } from './types';

export function buildRespiratory(): PartBuild {
  const tissue = createSolidMaterial({ whiten: 0.05, opacity: 0.62, roughness: 0.8 });
  const airway = createSolidMaterial({ whiten: 0.15 });

  const lungs = new THREE.Group();
  lungs.add(
    ellipsoid(v(0.08, 1.305, 0), v(0.054, 0.1, 0.066), tissue.material, new THREE.Euler(0, 0, 0.08)),
    ellipsoid(v(-0.08, 1.305, 0), v(0.058, 0.104, 0.068), tissue.material, new THREE.Euler(0, 0, -0.08)),
  );

  const carina = v(0, 1.37, 0.006);
  const airways = [
    tube([v(0, 1.52, 0.022), v(0, 1.45, 0.016), carina], 0.0095, airway.material),
    ...bothSides((s) => [tube([carina, s(v(0.035, 1.345, 0.004)), s(v(0.07, 1.31, 0))], 0.0065, airway.material)]),
  ];

  return {
    group: groupOf('respiratory', [lungs, ...airways]),
    materials: [tissue, airway],
    animate(elapsed, vitals) {
      const b = breath(elapsed, vitals);
      lungs.scale.set(1 + 0.035 * b, 1 + 0.02 * b, 1 + 0.06 * b);
      // Scale about the chest, not the world origin.
      lungs.position.set(0, -1.305 * 0.02 * b, 0);
    },
  };
}
