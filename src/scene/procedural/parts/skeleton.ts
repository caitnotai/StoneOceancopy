import * as THREE from 'three';
import { createGhostMaterial, createSolidMaterial } from '../../materials';
import { along, bothSides, capsuleBetween, ellipsoid, tube, v } from '../geometry';
import { LM } from '../landmarks';
import { groupOf, type PartBuild } from './types';

export function buildSkeleton(): PartBuild {
  const bone = createSolidMaterial({ whiten: 0.3, roughness: 0.7 });
  // The skull is drawn as a translucent vault so the brain and eyes stay visible.
  const vault = createGhostMaterial({ power: 2.2, base: 0.03, intensity: 0.6 });
  const m = bone.material;
  const parts: THREE.Object3D[] = [];

  // Skull and jaw
  parts.push(ellipsoid(v(0, 1.655, 0), v(0.086, 0.098, 0.1), vault.material));
  parts.push(ellipsoid(v(0, 1.562, 0.032), v(0.054, 0.03, 0.058), vault.material));

  // Spine: a column of vertebrae following a gentle S-curve.
  const vertebra = new THREE.CylinderGeometry(0.019, 0.019, 0.017, 10);
  const VERTEBRAE = 25;
  for (let i = 0; i < VERTEBRAE; i++) {
    const u = i / (VERTEBRAE - 1);
    const mesh = new THREE.Mesh(vertebra, m);
    const taper = 1.15 - 0.4 * u;
    mesh.position.set(0, 0.935 + u * 0.59, -0.047 + 0.016 * Math.sin(u * Math.PI * 2));
    mesh.scale.set(taper, 1, taper);
    parts.push(mesh);
  }

  // Rib cage: each rib is one tube running from the sternum, around the back, to the sternum.
  const RIBS = 10;
  for (let i = 0; i < RIBS; i++) {
    const y = 1.402 - i * 0.026;
    const a = 0.1 + 0.05 * Math.sin((Math.PI * (i + 1.5)) / (RIBS + 2));
    const b = a * 0.62;
    const gap = i < 7 ? 0.16 : 0.45 + (i - 7) * 0.28; // lower ribs do not reach the sternum
    const points: THREE.Vector3[] = [];
    const N = 22;
    for (let k = 0; k <= N; k++) {
      const phi = Math.PI / 2 + gap + ((2 * Math.PI - 2 * gap) * k) / N;
      const front = 0.5 + 0.5 * Math.sin(phi); // 1 at the sternum, 0 at the spine
      points.push(v(a * Math.cos(phi), y - 0.04 * front, -0.006 + b * Math.sin(phi)));
    }
    parts.push(tube(points, 0.0062, m, { segmentsPerPoint: 2, radialSegments: 6 }));
  }
  const sternum = capsuleBetween(v(0, 1.2, 0.083), v(0, 1.35, 0.078), 0.014, m);
  sternum.scale.z = 0.5;
  parts.push(sternum);

  // Pelvis: a closed ring with raised iliac crests, plus the sacrum.
  const ring: THREE.Vector3[] = [];
  for (let k = 0; k < 16; k++) {
    const phi = (2 * Math.PI * k) / 16;
    ring.push(v(0.122 * Math.cos(phi), 0.945 + 0.032 * Math.abs(Math.cos(phi)) - 0.02 * Math.sin(phi), -0.008 + 0.074 * Math.sin(phi)));
  }
  parts.push(tube(ring, 0.016, m, { closed: true, segmentsPerPoint: 3 }));
  parts.push(ellipsoid(v(0, 0.925, -0.06), v(0.04, 0.05, 0.02), m));

  parts.push(
    ...bothSides((s) => {
      const side: THREE.Object3D[] = [];
      const shoulder = s(LM.shoulder);
      const elbow = s(LM.elbow);
      const wrist = s(LM.wrist);
      const hip = s(LM.hip);
      const knee = s(LM.knee);
      const ankle = s(LM.ankle);
      const sign = shoulder.x > 0 ? 1 : -1;

      // Shoulder girdle
      side.push(capsuleBetween(s(v(0.018, 1.418, 0.068)), s(v(0.186, 1.428, 0.002)), 0.0075, m));
      side.push(ellipsoid(s(v(0.112, 1.33, -0.082)), v(0.048, 0.062, 0.008), m, new THREE.Euler(0.12, 0, sign * 0.18)));

      // Arm
      side.push(capsuleBetween(shoulder, elbow, 0.0135, m));
      side.push(capsuleBetween(along(elbow, wrist, 0, v(sign * 0.01, 0, 0)), along(wrist, elbow, 0, v(sign * 0.011, 0, 0)), 0.0078, m));
      side.push(capsuleBetween(along(elbow, wrist, 0, v(-sign * 0.01, 0, 0)), along(wrist, elbow, 0, v(-sign * 0.011, 0, 0)), 0.0078, m));
      for (let f = -1.5; f <= 1.5; f += 1) {
        side.push(capsuleBetween(wrist, s(LM.handTip).add(v(0, 0.012 * Math.abs(f), 0.012 * f)), 0.0042, m));
      }

      // Leg
      side.push(capsuleBetween(hip, knee, 0.019, m, 0.016));
      side.push(capsuleBetween(knee, ankle, 0.0155, m, 0.012));
      side.push(capsuleBetween(along(knee, ankle, 0.04, v(sign * 0.024, 0, -0.006)), along(knee, ankle, 0.98, v(sign * 0.018, 0, -0.004)), 0.0065, m));
      side.push(ellipsoid(along(knee, ankle, 0, v(0, 0.004, 0.03)), v(0.017, 0.02, 0.01), m));
      side.push(ellipsoid(s(LM.heel), v(0.022, 0.022, 0.03), m));
      for (let f = -1; f <= 1; f += 1) {
        side.push(capsuleBetween(ankle.clone().add(v(0, -0.03, 0.02)), s(LM.toe).add(v(0.014 * f, 0, -0.008 * Math.abs(f))), 0.0058, m));
      }

      // Joints
      const joints: [THREE.Vector3, number][] = [
        [shoulder, 0.021],
        [elbow, 0.017],
        [wrist, 0.012],
        [hip, 0.024],
        [knee, 0.024],
        [ankle, 0.016],
      ];
      for (const [p, r] of joints) side.push(ellipsoid(p, v(r, r, r), m));
      return side;
    }),
  );

  return { group: groupOf('skeleton', parts), materials: [bone, vault] };
}
