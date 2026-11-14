import * as THREE from 'three';
import { createGhostMaterial } from '../../materials';
import { along, bothSides, ellipsoid, spindleBetween, v } from '../geometry';
import { LM } from '../landmarks';
import { groupOf, type PartBuild } from './types';

export function buildMuscles(): PartBuild {
  // Fine scan lines suggest muscle fibres and tell this layer apart from the skin shell.
  const fibre = createGhostMaterial({ power: 1.8, base: 0.04, intensity: 0.34, scan: 0.55, scanFrequency: 520 });
  const m = fibre.material;

  const trunk: THREE.Object3D[] = [
    ellipsoid(v(0, 1.11, 0.074), v(0.068, 0.13, 0.026), m), // abdominals
    ellipsoid(v(0, 1.425, -0.05), v(0.125, 0.055, 0.04), m), // trapezius
  ];

  const paired = bothSides((s) => {
    const shoulder = s(LM.shoulder);
    const elbow = s(LM.elbow);
    const wrist = s(LM.wrist);
    const hip = s(LM.hip);
    const knee = s(LM.knee);
    const ankle = s(LM.ankle);
    const front = v(0, 0, 0.013);
    const back = v(0, 0, -0.015);
    return [
      ellipsoid(s(v(0.21, 1.385, -0.006)), v(0.05, 0.06, 0.05), m), // deltoid
      ellipsoid(s(v(0.078, 1.335, 0.066)), v(0.074, 0.05, 0.03), m), // pectoral
      ellipsoid(s(v(0.116, 1.1, 0.02)), v(0.034, 0.11, 0.066), m), // oblique
      ellipsoid(s(v(0.1, 1.22, -0.068)), v(0.07, 0.14, 0.034), m), // latissimus
      ellipsoid(s(v(0.085, 0.925, -0.062)), v(0.072, 0.068, 0.058), m), // gluteal
      spindleBetween(along(shoulder, elbow, 0.12, front), along(shoulder, elbow, 0.95, front), 0.03, m), // biceps
      spindleBetween(along(shoulder, elbow, 0.08, back), along(shoulder, elbow, 0.98, back), 0.03, m), // triceps
      spindleBetween(along(elbow, wrist, -0.02), along(elbow, wrist, 0.78), 0.034, m, 0.03), // forearm
      spindleBetween(along(hip, knee, 0.03, v(0, 0, 0.016)), along(hip, knee, 0.96, v(0, 0, 0.012)), 0.058, m, 0.05), // quadriceps
      spindleBetween(along(hip, knee, 0.06, v(0, 0, -0.024)), along(hip, knee, 0.94, v(0, 0, -0.016)), 0.05, m, 0.04), // hamstrings
      spindleBetween(along(knee, ankle, 0, v(0, 0, -0.02)), along(knee, ankle, 0.64, v(0, 0, -0.014)), 0.044, m, 0.038), // calf
      spindleBetween(along(knee, ankle, 0.05, v(0, 0, 0.014)), along(knee, ankle, 0.85, v(0, 0, 0.01)), 0.022, m), // tibialis
    ];
  });

  return { group: groupOf('muscles', [...trunk, ...paired]), materials: [fibre] };
}
