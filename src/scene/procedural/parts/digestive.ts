import * as THREE from 'three';
import { createSolidMaterial } from '../../materials';
import { ellipsoid, tube, v } from '../geometry';
import { groupOf, type PartBuild } from './types';

/** Esophagus, stomach, liver, pancreas and intestines. */
export function buildDigestive(): PartBuild {
  const organ = createSolidMaterial({ whiten: 0.08, roughness: 0.5 });
  const gut = createSolidMaterial({ whiten: 0.12, roughness: 0.65 });

  // Small intestine: a tube folded back and forth inside the frame of the colon.
  const coil: THREE.Vector3[] = [];
  const TURNS = 30;
  for (let i = 0; i <= TURNS; i++) {
    const t = i / TURNS;
    coil.push(v(0.058 * Math.sin(t * Math.PI * 7) * (1 - 0.25 * t), 1.085 - 0.125 * t, 0.046 + 0.022 * Math.cos(t * Math.PI * 5)));
  }

  const parts: THREE.Object3D[] = [
    tube([v(0, 1.5, -0.004), v(0, 1.36, -0.026), v(0.012, 1.24, -0.012), v(0.036, 1.2, 0.02)], 0.0062, gut.material), // esophagus
    ellipsoid(v(0.052, 1.176, 0.036), v(0.046, 0.034, 0.034), organ.material, new THREE.Euler(0, 0, 0.55)), // stomach
    ellipsoid(v(-0.056, 1.196, 0.036), v(0.074, 0.04, 0.054), organ.material, new THREE.Euler(0, 0, -0.22)), // liver
    ellipsoid(v(0.004, 1.142, 0.012), v(0.044, 0.011, 0.012), organ.material, new THREE.Euler(0, 0, 0.12)), // pancreas
    tube(coil, 0.0105, gut.material, { segmentsPerPoint: 4 }),
    // Large intestine: up the right side, across, and down the left.
    tube(
      [v(-0.082, 0.955, 0.036), v(-0.09, 1.04, 0.04), v(-0.084, 1.105, 0.044), v(0, 1.118, 0.056), v(0.084, 1.105, 0.044), v(0.09, 1.03, 0.04), v(0.07, 0.96, 0.03), v(0.01, 0.925, 0.008)],
      0.0155,
      gut.material,
    ),
  ];

  return { group: groupOf('digestive', parts), materials: [organ, gut] };
}
