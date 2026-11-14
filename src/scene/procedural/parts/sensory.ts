import * as THREE from 'three';
import { createSolidMaterial } from '../../materials';
import { bothSides, ellipsoid, tube, v } from '../geometry';
import { groupOf, type PartBuild } from './types';

/** Eyes with optic nerves (SANS) and the inner-ear balance organs (vestibular function). */
export function buildSensory(): PartBuild {
  const organ = createSolidMaterial({ whiten: 0.1, roughness: 0.3 });
  const m = organ.material;
  const canal = new THREE.TorusGeometry(0.011, 0.0032, 6, 18);

  const parts = bothSides((s) => {
    const eye = s(v(0.036, 1.648, 0.086));
    const ear = s(v(0.074, 1.624, -0.008));
    // Three semicircular canals at right angles: one per axis of head rotation.
    const canals = [new THREE.Euler(0, 0, 0), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Euler(0, Math.PI / 2, 0)].map((rotation) => {
      const ring = new THREE.Mesh(canal, m);
      ring.position.copy(ear);
      ring.rotation.copy(rotation);
      return ring;
    });
    return [
      ellipsoid(eye, v(0.0165, 0.0165, 0.0165), m),
      tube([eye, s(v(0.026, 1.648, 0.045)), s(v(0.006, 1.652, 0.012))], 0.0036, m),
      ellipsoid(ear, v(0.007, 0.007, 0.007), m),
      ...canals,
    ];
  });

  return { group: groupOf('sensory', parts), materials: [organ] };
}
