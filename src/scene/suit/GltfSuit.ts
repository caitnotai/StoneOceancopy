import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AstronautSuit } from './AstronautSuit';
import { SuitFade } from './SuitFade';

/** The suit is fitted to stand this tall, a little over the 1.76 m body it encloses. */
const SUIT_HEIGHT_M = 1.84;

/**
 * The astronaut: a suit loaded from `public/models/astronaut.glb`. Whatever its original size and origin,
 * it is fitted to the body's frame: feet on the ground, centred, facing +z as authored.
 */
export class GltfSuit implements AstronautSuit {
  readonly root = new THREE.Group();
  readonly pickables: THREE.Mesh[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly fade: SuitFade;
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
        this.materials.push(copy);
      }
      return copy;
    };
    const meshes: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = Array.isArray(object.material) ? object.material.map(own) : own(object.material);
      meshes.push(object);
    });
    this.pickables.push(...meshes);
    this.fade = new SuitFade(meshes);
  }

  setOpacity(opacity: number): void {
    this.root.visible = opacity > 0.01;
    this.fade.setOpacity(opacity);
    this.root.scale.setScalar(1 + 0.02 * this.fade.hologramAt(opacity));
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
    this.fade.dispose();
    this.fitted.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.materials.forEach((material) => material.dispose());
  }
}
