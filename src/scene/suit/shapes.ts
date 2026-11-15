import * as THREE from 'three';

/**
 * Small modelling kit for the built-in suit: just enough to draw a human figure in a suit
 * with soft, tapered forms instead of plain capsules and spheres.
 */

/** One horizontal slice of a lofted body: where it is and how wide and deep. */
export interface Slice {
  y: number;
  /** Half-width (x) and half-depth (z). */
  rx: number;
  rz: number;
  /** Shift of the slice forward (+z). */
  cz?: number;
}

/**
 * A closed surface through a stack of rounded-rectangle slices: a torso, a backpack, a boot.
 * `squareness` 2 gives ellipses; higher values give flatter sides with rounded corners.
 */
export function loft(slices: readonly Slice[], squareness = 2, segments = 40): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const power = 2 / squareness;
  for (const { y, rx, rz, cz = 0 } of slices) {
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      positions.push(rx * Math.sign(c) * Math.abs(c) ** power, y, cz + rz * Math.sign(s) * Math.abs(s) ** power);
    }
  }
  for (let row = 0; row < slices.length - 1; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * segments + i;
      const b = row * segments + ((i + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      // Slices are listed top to bottom; this winding faces outward.
      indices.push(a, b, c, b, d, c);
    }
  }
  const cap = (row: number, flip: boolean): void => {
    const { y, cz = 0 } = slices[row];
    const centre = positions.length / 3;
    positions.push(0, y, cz);
    for (let i = 0; i < segments; i++) {
      const a = row * segments + i;
      const b = row * segments + ((i + 1) % segments);
      if (flip) indices.push(centre, a, b);
      else indices.push(centre, b, a);
    }
  };
  cap(0, false);
  cap(slices.length - 1, true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A limb segment from `from` to `to`: round in section, with the radius following `radii`
 * along its length (so an arm can taper and a calf can swell) and rounded at both ends.
 */
export function limb(from: THREE.Vector3, to: THREE.Vector3, radii: readonly number[], roundEnds = true): { geometry: THREE.BufferGeometry; position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const axis = to.clone().sub(from);
  const length = axis.length();
  const profile: THREE.Vector2[] = [];
  const first = radii[0];
  const last = radii[radii.length - 1];
  const arc = 6;
  if (roundEnds) for (let i = 0; i < arc; i++) profile.push(new THREE.Vector2(first * Math.sin(((i / arc) * Math.PI) / 2), -first * 0.8 * Math.cos(((i / arc) * Math.PI) / 2)));
  // The radius between the given samples is eased, not kinked.
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const scaled = t * (radii.length - 1);
    const index = Math.min(radii.length - 2, Math.floor(scaled));
    const local = scaled - index;
    const eased = local * local * (3 - 2 * local);
    profile.push(new THREE.Vector2(radii[index] + (radii[index + 1] - radii[index]) * eased, t * length));
  }
  if (roundEnds) for (let i = 1; i <= arc; i++) profile.push(new THREE.Vector2(last * Math.cos(((i / arc) * Math.PI) / 2), length + last * 0.8 * Math.sin(((i / arc) * Math.PI) / 2)));
  return {
    geometry: new THREE.LatheGeometry(profile, 28),
    position: from.clone(),
    quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()),
  };
}

/** The pleated section of a suit joint (elbow, knee): a short sleeve with soft ridges. */
export function bellows(length: number, radius: number, ridges: number): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  const steps = ridges * 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    profile.push(new THREE.Vector2(radius + 0.0055 * (0.5 - 0.5 * Math.cos(t * ridges * Math.PI * 2)), (t - 0.5) * length));
  }
  return new THREE.LatheGeometry(profile, 28);
}

/** A metal connection ring (neck, wrist, ankle, waist): a short band with bevelled edges. */
export function ring(radius: number, height: number, thickness: number): THREE.BufferGeometry {
  const h = height / 2;
  const bevel = Math.min(thickness, height) * 0.3;
  const inner = radius - thickness * 0.5;
  const outer = radius + thickness * 0.5;
  return new THREE.LatheGeometry(
    [
      new THREE.Vector2(inner, -h),
      new THREE.Vector2(outer - bevel, -h),
      new THREE.Vector2(outer, -h + bevel),
      new THREE.Vector2(outer, h - bevel),
      new THREE.Vector2(outer - bevel, h),
      new THREE.Vector2(inner, h),
    ],
    36,
  );
}

/** The outline of a boot sole seen from above (toe toward +y of the shape), extruded upward by the caller. */
export function soleShape(width: number, heel: number, toe: number): THREE.Shape {
  const w = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w * 0.78, -heel * 0.55);
  shape.bezierCurveTo(-w * 0.8, -heel * 1.05, w * 0.8, -heel * 1.05, w * 0.78, -heel * 0.55);
  shape.bezierCurveTo(w * 0.9, 0, w * 1.08, toe * 0.35, w * 1.0, toe * 0.72);
  shape.bezierCurveTo(w * 0.9, toe * 1.08, -w * 0.9, toe * 1.08, -w * 1.0, toe * 0.72);
  shape.bezierCurveTo(-w * 1.08, toe * 0.35, -w * 0.9, 0, -w * 0.78, -heel * 0.55);
  return shape;
}
