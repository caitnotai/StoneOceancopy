import * as THREE from 'three';
import { createGhostMaterial } from '../../materials';
import { bothSides, capsuleBetween, ellipsoid, spindleBetween, v } from '../geometry';
import { LM } from '../landmarks';
import { groupOf, type PartBuild } from './types';

/**
 * The body outline. It doubles as the "radiation exposure" layer: dose is absorbed by the
 * whole body, so the silhouette itself carries that status.
 */
export function buildShell(): PartBuild {
  const skin = createGhostMaterial({ power: 2.6, base: 0.012, intensity: 0.6, scan: 0.22, scanFrequency: 170 });
  const m = skin.material;

  // Torso: a lathe profile (radius, height) flattened front-to-back.
  const profile = [
    [0.001, 0.842],
    [0.09, 0.85],
    [0.152, 0.9],
    [0.166, 0.96],
    [0.157, 1.03],
    [0.143, 1.1],
    [0.141, 1.15],
    [0.158, 1.24],
    [0.181, 1.33],
    [0.189, 1.39],
    [0.166, 1.435],
    [0.09, 1.462],
    [0.001, 1.47],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 36), m);
  torso.scale.z = 0.6;

  const limbs = bothSides((s) => [
    capsuleBetween(s(LM.shoulder), s(LM.elbow), 0.05, m, 0.04),
    capsuleBetween(s(LM.elbow), s(LM.wrist), 0.04, m, 0.028),
    spindleBetween(s(LM.wrist), s(LM.handTip), 0.036, m, 0.017),
    capsuleBetween(s(LM.hip), s(LM.knee), 0.08, m, 0.054),
    capsuleBetween(s(LM.knee), s(LM.ankle), 0.054, m, 0.036),
    capsuleBetween(s(LM.heel), s(LM.toe), 0.036, m, 0.03),
  ]);

  const group = groupOf('shell', [
    ellipsoid(LM.headCenter, LM.headRadii, m),
    capsuleBetween(LM.neckBase, LM.neckTop, 0.05, m, 0.046),
    torso,
    ellipsoid(v(0, 0.9, -0.01), v(0.16, 0.085, 0.1), m),
    ...limbs,
  ]);
  return { group, materials: [skin] };
}
