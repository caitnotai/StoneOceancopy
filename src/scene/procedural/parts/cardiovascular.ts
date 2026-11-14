import * as THREE from 'three';
import { heartScale } from '../../animation';
import { createSolidMaterial } from '../../materials';
import { bothSides, ellipsoid, tube, v } from '../geometry';
import { LM } from '../landmarks';
import { groupOf, type PartBuild } from './types';

export function buildCardiovascular(): PartBuild {
  const blood = createSolidMaterial({ roughness: 0.35 });
  const m = blood.material;

  const heartCenter = v(0.022, 1.296, 0.036);
  const heart = new THREE.Group();
  heart.position.copy(heartCenter);
  heart.add(
    ellipsoid(v(0, 0, 0), v(0.043, 0.054, 0.04), m, new THREE.Euler(0, 0, -0.5)),
    ellipsoid(v(-0.022, 0.034, -0.004), v(0.026, 0.024, 0.024), m),
    ellipsoid(v(0.014, 0.04, -0.008), v(0.022, 0.02, 0.02), m),
  );

  const arch = v(0, 1.368, 0.006);
  const fork = v(0, 0.972, -0.012);
  const trunk = [
    tube([heartCenter.clone().add(v(-0.01, 0.04, 0)), arch, v(0.004, 1.32, -0.026), v(0, 1.15, -0.028), fork], 0.0115, m),
  ];

  const branches = bothSides((s) => [
    // Carotid artery up into the head
    tube([arch, s(v(0.03, 1.45, 0.016)), s(v(0.044, 1.55, 0.018)), s(v(0.052, 1.64, 0.004)), s(v(0.034, 1.715, -0.006))], 0.0058, m),
    // Subclavian and brachial artery down the arm
    tube([arch, s(v(0.1, 1.408, 0.012)), s(LM.shoulder).add(v(0, -0.02, 0.012)), s(LM.elbow).add(v(0, 0, 0.012)), s(LM.wrist).add(v(0, 0, 0.004)), s(LM.handTip).add(v(0, 0.03, 0))], 0.0056, m),
    // Iliac and femoral artery down the leg
    tube([fork, s(LM.hip).add(v(-0.012, -0.012, 0.022)), s(v(0.096, 0.7, 0.03)), s(LM.knee).add(v(0, 0, -0.016)), s(v(0.104, 0.3, -0.02)), s(LM.ankle).add(v(0, 0, 0.012)), s(LM.toe).add(v(0, 0.012, -0.05))], 0.0066, m),
    // Renal branch
    tube([v(0, 1.13, -0.028), s(v(0.04, 1.125, -0.03)), s(v(0.07, 1.13, -0.036))], 0.0045, m),
    ellipsoid(s(v(0.078, 1.13, -0.04)), v(0.018, 0.03, 0.014), m),
  ]);

  return {
    group: groupOf('cardiovascular', [heart, ...trunk, ...branches]),
    materials: [blood],
    animate(elapsed, vitals) {
      heart.scale.setScalar(heartScale(elapsed, vitals));
    },
  };
}
