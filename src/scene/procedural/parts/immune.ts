import * as THREE from 'three';
import { createSolidMaterial } from '../../materials';
import { bothSides, ellipsoid, tube, v } from '../geometry';
import { LM } from '../landmarks';
import { groupOf, type PartBuild } from './types';

/** Lymph nodes and vessels, thymus and spleen. */
export function buildImmune(): PartBuild {
  const node = createSolidMaterial({ whiten: 0.08, roughness: 0.4 });
  const vessel = createSolidMaterial({ whiten: 0.18, opacity: 0.85 });
  const dot = (p: THREE.Vector3, r = 0.0125): THREE.Mesh => ellipsoid(p, v(r, r * 1.3, r), node.material);

  const duct = v(0.012, 1.4, 0.012);
  const cistern = v(0.008, 1.0, -0.02);
  const parts: THREE.Object3D[] = [
    ellipsoid(v(0, 1.392, 0.052), v(0.03, 0.034, 0.014), node.material), // thymus
    ellipsoid(v(0.108, 1.172, -0.03), v(0.028, 0.044, 0.024), node.material, new THREE.Euler(0, 0, 0.35)), // spleen
    tube([cistern, v(0.014, 1.2, -0.03), duct], 0.0036, vessel.material), // thoracic duct
    ...bothSides((s) => {
      const neck = [s(v(0.046, 1.545, 0.012)), s(v(0.05, 1.495, 0.02))];
      const armpit = [s(v(0.165, 1.345, 0.004)), s(v(0.15, 1.31, 0.012))];
      const groin = [s(v(0.074, 0.9, 0.05)), s(v(0.094, 0.87, 0.045))];
      const elbow = s(LM.elbow).add(v(0, 0, 0.014));
      const knee = s(LM.knee).add(v(0, 0, -0.034));
      return [
        ...[...neck, ...armpit, ...groin].map((p) => dot(p)),
        dot(elbow, 0.009),
        dot(knee, 0.01),
        tube([neck[0], neck[1], duct], 0.0028, vessel.material),
        tube([s(LM.wrist), elbow, armpit[0], armpit[1], duct], 0.0028, vessel.material),
        tube([s(LM.ankle).add(v(0, 0.02, 0.01)), knee, groin[1], groin[0], cistern], 0.0028, vessel.material),
      ];
    }),
  ];

  return { group: groupOf('immune', parts), materials: [node, vessel] };
}
