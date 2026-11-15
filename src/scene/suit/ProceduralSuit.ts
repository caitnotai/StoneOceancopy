import * as THREE from 'three';
import { HOLOGRAM_COLOR, type AstronautSuit } from './AstronautSuit';

interface Part {
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
}

/**
 * A soft, rounded space suit built from simple volumes, sized to enclose the anatomical
 * body. It is the fallback while no `astronaut.glb` is provided, and needs no download.
 */
export class ProceduralSuit implements AstronautSuit {
  readonly root = new THREE.Group();
  private readonly parts: Part[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly torso: THREE.Group = new THREE.Group();
  private readonly lamp: Part;
  private readonly hologram = new THREE.Color(HOLOGRAM_COLOR);

  constructor() {
    this.root.name = 'astronaut-suit';
    const fabric = this.part(0xeef1f6, 0.78, 0).material;
    const trim = this.part(0xa9b4c8, 0.6, 0.1).material;
    const accent = this.part(0x3987e5, 0.55, 0.1).material;
    const visor = this.part(0x12305e, 0.1, 0.7).material;
    this.lamp = this.part(0x898781, 0.4, 0);

    const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]): THREE.Mesh => {
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      // Drawn after the anatomy, so a translucent suit sits over it.
      mesh.renderOrder = 4;
      parent.add(mesh);
      return mesh;
    };
    const up = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(0, 0, 1);
    const limb = (from: THREE.Vector3, to: THREE.Vector3, radius: number): void => {
      const direction = to.clone().sub(from);
      const mesh = add(this.root, new THREE.CapsuleGeometry(radius, direction.length(), 6, 18), fabric, [0, 0, 0]);
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    };
    /** A ring around a limb, facing along it. */
    const cuff = (at: THREE.Vector3, toward: THREE.Vector3, radius: number, material: THREE.Material): void => {
      const mesh = add(this.root, new THREE.TorusGeometry(radius, 0.014, 10, 28), material, [at.x, at.y, at.z]);
      mesh.quaternion.setFromUnitVectors(forward, toward.clone().sub(at).normalize());
    };
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

    // Helmet, visor and neck ring.
    add(this.root, new THREE.SphereGeometry(0.175, 40, 28), fabric, [0, 1.635, 0.005]);
    add(this.root, new THREE.SphereGeometry(0.142, 40, 28), visor, [0, 1.64, 0.088], [1, 0.82, 0.8]);
    add(this.root, new THREE.TorusGeometry(0.118, 0.022, 12, 36), trim, [0, 1.47, 0]).rotation.x = Math.PI / 2;

    // Torso: it breathes, so it has its own group.
    this.torso.position.set(0, 1.2, 0);
    this.root.add(this.torso);
    add(this.torso, new THREE.CapsuleGeometry(0.2, 0.22, 10, 28), fabric, [0, 0, 0], [1.16, 1, 0.84]);
    add(this.torso, new THREE.BoxGeometry(0.36, 0.46, 0.15), trim, [0, 0.03, -0.2]);
    add(this.torso, new THREE.BoxGeometry(0.2, 0.13, 0.05), trim, [0, 0.03, 0.175]);
    add(this.torso, new THREE.SphereGeometry(0.016, 16, 12), this.lamp.material, [0.055, 0.05, 0.203]);
    add(this.torso, new THREE.BoxGeometry(0.09, 0.016, 0.01), accent, [-0.04, 0.05, 0.202]);
    add(this.root, new THREE.SphereGeometry(0.2, 28, 20), fabric, [0, 0.93, 0], [1.1, 0.72, 0.84]);
    add(this.root, new THREE.TorusGeometry(0.2, 0.02, 10, 36), trim, [0, 1.0, 0], [1.12, 0.86, 1]).rotation.x = Math.PI / 2;

    for (const side of [1, -1]) {
      const shoulder = V(side * 0.245, 1.4, 0);
      const elbow = V(side * 0.315, 1.13, 0);
      const wrist = V(side * 0.365, 0.875, 0.02);
      add(this.root, new THREE.SphereGeometry(0.084, 24, 16), fabric, [shoulder.x, shoulder.y, shoulder.z]);
      limb(shoulder, elbow, 0.074);
      limb(elbow, wrist, 0.066);
      cuff(elbow, wrist, 0.07, accent);
      cuff(wrist, elbow, 0.062, trim);
      add(this.root, new THREE.SphereGeometry(0.068, 20, 14), trim, [side * 0.385, 0.78, 0.035], [0.9, 1.15, 1]);

      const hip = V(side * 0.105, 0.9, 0);
      const knee = V(side * 0.115, 0.5, 0.012);
      const ankle = V(side * 0.115, 0.13, 0);
      limb(hip, knee, 0.1);
      limb(knee, ankle, 0.085);
      cuff(knee, ankle, 0.09, accent);
      cuff(ankle, knee, 0.082, trim);
      add(this.root, new THREE.SphereGeometry(0.095, 20, 14), trim, [side * 0.115, 0.055, 0.045], [1, 0.6, 1.5]);
    }
  }

  setOpacity(opacity: number): void {
    this.root.visible = opacity > 0.01;
    // The more see-through the suit, the more it reads as a blue hologram.
    const holo = 1 - THREE.MathUtils.smoothstep(opacity, 0.15, 0.85);
    const solid = opacity > 0.98;
    for (const part of this.parts) {
      const { material, color } = part;
      if (material.transparent === solid) {
        material.transparent = !solid;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
      material.depthWrite = solid;
      material.color.copy(color).lerp(this.hologram, holo);
      if (part !== this.lamp) material.emissive.copy(this.hologram).multiplyScalar(0.3 * holo);
    }
    this.root.scale.setScalar(1 + 0.025 * holo);
  }

  setStatusColor(color: THREE.Color): void {
    this.lamp.color.copy(color);
    this.lamp.material.color.copy(color);
    this.lamp.material.emissive.copy(color);
    this.lamp.material.emissiveIntensity = 1.6;
  }

  update(_elapsed: number, breath: number): void {
    this.torso.scale.set(1 + 0.012 * breath, 1 + 0.006 * breath, 1 + 0.022 * breath);
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.parts.forEach((part) => part.material.dispose());
  }

  private part(color: number, roughness: number, metalness: number): Part {
    const part = { material: new THREE.MeshStandardMaterial({ color, roughness, metalness }), color: new THREE.Color(color) };
    this.parts.push(part);
    return part;
  }
}
