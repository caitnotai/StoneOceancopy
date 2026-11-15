import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HOLOGRAM_COLOR, type AstronautSuit } from './AstronautSuit';

/** The suit is fitted to stand this tall, a little over the 1.76 m body it encloses. */
const SUIT_HEIGHT_M = 1.84;

type TintedMaterial = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };
interface Part {
  material: TintedMaterial;
  color: THREE.Color | null;
  emissive: THREE.Color | null;
}

/**
 * A suit loaded from `public/models/astronaut.glb`. Whatever its original size and origin,
 * it is fitted to the body's frame: feet on the ground, centred, facing +z as authored.
 */
export class GltfSuit implements AstronautSuit {
  readonly root = new THREE.Group();
  private readonly parts: Part[] = [];
  private readonly hologram = new THREE.Color(HOLOGRAM_COLOR);
  private readonly fitted = new THREE.Group();

  /** Resolves to null when there is no usable model at `url`: the caller keeps its fallback. */
  static async load(url: string): Promise<GltfSuit | null> {
    try {
      // A missing file is the normal case, and a dev server answers it with an HTML page.
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) return null;
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
      return new GltfSuit(gltf.scene);
    } catch (error) {
      console.warn('Astronaut model could not be loaded, keeping the built-in suit.', error);
      return null;
    }
  }

  private constructor(scene: THREE.Object3D) {
    this.root.name = 'astronaut-suit';
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    scene.position.set(-centre.x, -box.min.y, -centre.z);
    this.fitted.scale.setScalar(size.y > 0 ? SUIT_HEIGHT_M / size.y : 1);
    this.fitted.add(scene);
    this.root.add(this.fitted);

    // Materials are copied so that fading the suit never touches the loader's shared ones.
    const copies = new Map<THREE.Material, THREE.Material>();
    const own = (material: THREE.Material): THREE.Material => {
      let copy = copies.get(material);
      if (!copy) {
        copy = material.clone();
        copies.set(material, copy);
        const tinted = copy as TintedMaterial;
        this.parts.push({ material: tinted, color: tinted.color?.clone() ?? null, emissive: tinted.emissive?.clone() ?? null });
      }
      return copy;
    };
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.renderOrder = 4;
      object.material = Array.isArray(object.material) ? object.material.map(own) : own(object.material);
    });
  }

  setOpacity(opacity: number): void {
    this.root.visible = opacity > 0.01;
    const holo = 1 - THREE.MathUtils.smoothstep(opacity, 0.15, 0.85);
    const solid = opacity > 0.98;
    for (const { material, color, emissive } of this.parts) {
      if (material.transparent === solid) {
        material.transparent = !solid;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
      material.depthWrite = solid;
      if (color && material.color) material.color.copy(color).lerp(this.hologram, holo);
      if (emissive && material.emissive) material.emissive.copy(emissive).lerp(this.hologram, 0.55 * holo);
    }
    this.root.scale.setScalar(1 + 0.025 * holo);
  }

  /** A loaded model has no agreed place for a status light; the dashboard shows the status instead. */
  setStatusColor(): void {}

  update(_elapsed: number, breath: number): void {
    // No rig is assumed: the whole figure swells very slightly with each breath.
    const base = this.fitted.scale.y;
    this.fitted.scale.x = base * (1 + 0.004 * breath);
    this.fitted.scale.z = base * (1 + 0.008 * breath);
  }

  dispose(): void {
    this.fitted.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.parts.forEach((part) => part.material.dispose());
  }
}
