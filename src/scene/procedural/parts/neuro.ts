import * as THREE from 'three';
import { createSolidMaterial } from '../../materials';
import { bothSides, ellipsoid, tube, v } from '../geometry';
import { LM } from '../landmarks';
import { groupOf, type PartBuild } from './types';

/** A sphere pushed in and out to suggest the folds of the cortex and the split between hemispheres. */
function brainGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 56, 40);
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const folds =
      Math.sin(p.x * 13 + Math.sin(p.y * 9) * 2.2) * Math.sin(p.y * 12 + Math.sin(p.z * 10) * 2.2) * Math.sin(p.z * 11 + p.x * 4);
    const fissure = p.y > -0.3 ? Math.exp(-(p.x * p.x) / 0.006) : 0;
    p.multiplyScalar(1 + 0.055 * folds - 0.13 * fissure);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function buildNeuro(): PartBuild {
  const cortex = createSolidMaterial({ whiten: 0.1, roughness: 0.6 });
  const nerve = createSolidMaterial({ whiten: 0.18 });

  const brain = new THREE.Mesh(brainGeometry(), cortex.material);
  brain.position.set(0, 1.676, -0.004);
  brain.scale.set(0.074, 0.058, 0.086);

  const cordTop = v(0, 1.6, -0.03);
  const cordBase = v(0, 0.99, -0.04);
  const parts: THREE.Object3D[] = [
    brain,
    ellipsoid(v(0, 1.617, -0.058), v(0.042, 0.024, 0.03), cortex.material), // cerebellum
    // Brainstem and spinal cord
    tube([v(0, 1.64, -0.012), cordTop, v(0, 1.45, -0.038), v(0, 1.2, -0.05), cordBase], 0.0062, nerve.material),
    ...bothSides((s) => [
      // Brachial nerves to the hand
      tube([v(0, 1.43, -0.038), s(v(0.1, 1.41, -0.03)), s(LM.shoulder).add(v(0, -0.03, -0.014)), s(LM.elbow).add(v(0, 0, -0.014)), s(LM.wrist).add(v(0, 0, -0.008))], 0.003, nerve.material),
      // Sciatic nerve to the foot
      tube([cordBase, s(LM.hip).add(v(0, -0.02, -0.035)), s(v(0.098, 0.7, -0.03)), s(LM.knee).add(v(0, 0, -0.03)), s(LM.ankle).add(v(0, 0.02, -0.018))], 0.0034, nerve.material),
    ]),
  ];

  return { group: groupOf('neuro', parts), materials: [cortex, nerve] };
}
