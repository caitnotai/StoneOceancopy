import * as THREE from 'three';

/** Small helpers for building anatomy out of primitives. Units are metres; feet at y = 0. */

export const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Mirrors a point to the other side of the body. */
export const mirror = (p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(-p.x, p.y, p.z);

/** Point at fraction `t` of the way from `a` to `b`, optionally shifted. */
export const along = (a: THREE.Vector3, b: THREE.Vector3, t: number, offset?: THREE.Vector3): THREE.Vector3 => {
  const p = a.clone().lerp(b, t);
  return offset ? p.add(offset) : p;
};

const UP = new THREE.Vector3(0, 1, 0);
const UNIT_SPHERE = new THREE.SphereGeometry(1, 28, 18);

function alignBetween(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
}

/** Capsule from `a` to `b`. With `radiusB` it tapers, like a limb segment. */
export function capsuleBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radiusB = radius,
): THREE.Mesh {
  const length = a.distanceTo(b);
  let geometry: THREE.BufferGeometry;
  if (Math.abs(radiusB - radius) < 1e-6) {
    geometry = new THREE.CapsuleGeometry(radius, length, 6, 14);
  } else {
    const profile: THREE.Vector2[] = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const angle = -Math.PI / 2 + (Math.PI / 2) * (i / steps);
      profile.push(new THREE.Vector2(Math.max(radius * Math.cos(angle), 1e-4), -length / 2 + radius * Math.sin(angle)));
    }
    for (let i = 0; i <= steps; i++) {
      const angle = (Math.PI / 2) * (i / steps);
      profile.push(new THREE.Vector2(Math.max(radiusB * Math.cos(angle), 1e-4), length / 2 + radiusB * Math.sin(angle)));
    }
    geometry = new THREE.LatheGeometry(profile, 16);
  }
  const mesh = new THREE.Mesh(geometry, material);
  alignBetween(mesh, a, b);
  return mesh;
}

/** Ellipsoid centred at `center` with the given semi-axes. */
export function ellipsoid(
  center: THREE.Vector3,
  radii: THREE.Vector3,
  material: THREE.Material,
  rotation?: THREE.Euler,
): THREE.Mesh {
  const mesh = new THREE.Mesh(UNIT_SPHERE, material);
  mesh.position.copy(center);
  mesh.scale.copy(radii);
  if (rotation) mesh.rotation.copy(rotation);
  return mesh;
}

/** Spindle (muscle-belly shape) stretched from `a` to `b`. */
export function spindleBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  width: number,
  material: THREE.Material,
  depth = width,
): THREE.Mesh {
  const mesh = new THREE.Mesh(UNIT_SPHERE, material);
  alignBetween(mesh, a, b);
  mesh.scale.set(width, a.distanceTo(b) / 2, depth);
  return mesh;
}

/** Smooth tube through a list of points (vessels, nerves, ribs, gut). */
export function tube(
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  options: { closed?: boolean; segmentsPerPoint?: number; radialSegments?: number } = {},
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, options.closed ?? false, 'catmullrom', 0.5);
  const tubular = Math.max(8, Math.round(points.length * (options.segmentsPerPoint ?? 8)));
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, tubular, radius, options.radialSegments ?? 7, options.closed ?? false),
    material,
  );
}

/**
 * Runs a builder for the left side and mirrors its points for the right side.
 * The mapper always returns a fresh vector, so builders may mutate the result freely.
 */
export function bothSides(build: (side: (p: THREE.Vector3) => THREE.Vector3) => THREE.Object3D[]): THREE.Object3D[] {
  return [...build((p) => p.clone()), ...build(mirror)];
}
