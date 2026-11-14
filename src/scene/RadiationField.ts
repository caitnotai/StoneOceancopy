import * as THREE from 'three';

const MAX_PARTICLES = 520;
const RADIUS = 2.4;
const CENTER = new THREE.Vector3(0, 0.9, 0);
const STREAK = 0.11;

/**
 * Energetic particles streaking through the cabin. Their number follows the current dose
 * rate, so a solar particle event is visible before the dose total crosses a threshold.
 */
export class RadiationField {
  readonly object: THREE.LineSegments;
  private readonly positions = new Float32Array(MAX_PARTICLES * 6);
  private readonly heads: THREE.Vector3[] = [];
  private readonly directions: THREE.Vector3[] = [];
  private readonly speeds: number[] = [];
  private readonly material: THREE.LineBasicMaterial;
  private active = 0;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.heads.push(new THREE.Vector3());
      this.directions.push(new THREE.Vector3());
      this.speeds.push(1);
      this.respawn(i, true);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(geometry, this.material);
    this.object.frustumCulled = false;
  }

  /** @param mSvPerDay current dose rate */
  setDoseRate(mSvPerDay: number): void {
    this.active = Math.round(Math.min(MAX_PARTICLES, Math.max(0, mSvPerDay) * 70));
    this.object.geometry.setDrawRange(0, this.active * 2);
  }

  setColor(color: THREE.Color): void {
    this.material.color.copy(color);
  }

  update(dt: number): void {
    const tail = new THREE.Vector3();
    for (let i = 0; i < this.active; i++) {
      const head = this.heads[i];
      head.addScaledVector(this.directions[i], this.speeds[i] * dt);
      if (head.distanceToSquared(CENTER) > RADIUS * RADIUS) this.respawn(i, false);
      tail.copy(head).addScaledVector(this.directions[i], -STREAK);
      this.positions.set([head.x, head.y, head.z, tail.x, tail.y, tail.z], i * 6);
    }
    this.object.geometry.attributes.position.needsUpdate = true;
  }

  /** Places a particle on the boundary sphere, aimed at a random point near the body. */
  private respawn(i: number, anywhere: boolean): void {
    const start = new THREE.Vector3().randomDirection().multiplyScalar(RADIUS * 0.98).add(CENTER);
    const aim = new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * 1.1).add(CENTER);
    this.directions[i].copy(aim).sub(start).normalize();
    this.speeds[i] = 2.2 + Math.random() * 2.6;
    this.heads[i].copy(start);
    if (anywhere) this.heads[i].addScaledVector(this.directions[i], Math.random() * RADIUS * 1.6);
  }
}
