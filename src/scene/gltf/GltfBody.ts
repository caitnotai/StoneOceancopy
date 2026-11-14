import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { SYSTEM_IDS, type SystemId } from '../../domain/types';
import { breath, heartScale } from '../animation';
import type { BodyModel, SystemLayer, Vitals } from '../BodyModel';
import { createGhostMaterial, createSolidMaterial, createVeilMaterial, type StatusMaterial } from '../materials';
import { ellipsoid, tube, v } from '../procedural/geometry';

// A bounding-volume hierarchy per mesh makes clicking a million-triangle body instant.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** How each part of the model is drawn. Keys are "<system>/<part>" as written by the build script. */
const PART_MATERIALS: Record<string, () => StatusMaterial> = {
  'radiation/skin': () => createGhostMaterial({ power: 2.4, base: 0.012, intensity: 0.5, scan: 0.22, scanFrequency: 170 }),
  'skeletal/bones': () => createSolidMaterial({ whiten: 0.3, roughness: 0.7 }),
  'muscular/muscles': () => createVeilMaterial({ rest: 0.13, roughness: 0.55 }),
  'cardiovascular/heart': () => createSolidMaterial({ roughness: 0.35 }),
  'cardiovascular/vessels': () => createSolidMaterial({ roughness: 0.4 }),
  'respiratory/airways': () => createSolidMaterial({ whiten: 0.15 }),
  'respiratory/lungs': () => createVeilMaterial({ rest: 0.2, focused: 0.38, roughness: 0.8 }),
  'neuro/brain': () => createSolidMaterial({ whiten: 0.1, roughness: 0.6 }),
  'sensory/eyes': () => createSolidMaterial({ whiten: 0.1, roughness: 0.3 }),
  'immune/lymphoid': () => createSolidMaterial({ whiten: 0.08, roughness: 0.4 }),
  'metabolic/organs': () => createSolidMaterial({ whiten: 0.1, roughness: 0.55 }),
};

type Landmarks = Record<string, [number, number, number] | undefined>;

/**
 * Moves a decoded mesh into plain world-space floats. The file stores quantized positions
 * with a per-node transform; baking them keeps bounds, pivots and picking simple.
 */
function bakeGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const source = mesh.geometry.attributes.position;
  const positions = new Float32Array(source.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < source.count; i++) {
    p.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(mesh.geometry.index);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundsTree();
  return geometry;
}

/** Wraps a mesh so it can scale about its own centre (heartbeat, breathing). */
function pivotAtCentre(mesh: THREE.Mesh): THREE.Group {
  const centre = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.position.copy(centre);
  mesh.position.copy(centre).negate();
  pivot.add(mesh);
  return pivot;
}

/**
 * The anatomical body: real bones, muscles, vessels and organs from the BodyParts3D atlas
 * (CC BY 4.0), reduced and grouped by body system by `tools/build-body-model.mjs`.
 */
export class GltfBody implements BodyModel {
  readonly root = new THREE.Group();
  readonly layers: Map<SystemId, SystemLayer> = new Map();
  readonly pickables: THREE.Mesh[] = [];
  private heart: THREE.Object3D | null = null;
  private lungs: THREE.Object3D | null = null;

  static async load(url: string, onProgress?: (fraction: number) => void): Promise<GltfBody> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url, (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    });
    return new GltfBody(gltf.scene);
  }

  private constructor(scene: THREE.Object3D) {
    this.root.name = 'body';
    for (const id of SYSTEM_IDS) {
      const group = new THREE.Group();
      group.name = id;
      this.layers.set(id, { id, group, materials: [] });
      this.root.add(group);
    }

    scene.updateMatrixWorld(true);
    const sources: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) sources.push(object);
    });
    for (const source of sources) {
      const system = source.userData.system as SystemId | undefined;
      const key = `${system}/${source.userData.part}`;
      const createMaterial = PART_MATERIALS[key];
      const layer = system ? this.layers.get(system) : undefined;
      if (!layer || !createMaterial) continue;

      const material = createMaterial();
      const mesh = new THREE.Mesh(bakeGeometry(source), material.material);
      source.geometry.dispose();
      this.register(mesh, layer, material);
      if (key === 'cardiovascular/heart') layer.group.add((this.heart = pivotAtCentre(mesh)));
      else if (key === 'respiratory/lungs') layer.group.add((this.lungs = pivotAtCentre(mesh)));
      else layer.group.add(mesh);
    }

    const landmarks = (scene.userData.landmarks ?? {}) as Landmarks;
    this.addLymphNodes(landmarks);
    this.addInnerEars(landmarks);
  }

  update(elapsed: number, vitals: Vitals): void {
    this.heart?.scale.setScalar(heartScale(elapsed, vitals));
    if (this.lungs) {
      const b = breath(elapsed, vitals);
      this.lungs.scale.set(1 + 0.02 * b, 1 + 0.015 * b, 1 + 0.03 * b);
    }
  }

  dispose(): void {
    for (const mesh of this.pickables) {
      mesh.geometry.disposeBoundsTree?.();
      mesh.geometry.dispose();
    }
    for (const layer of this.layers.values()) layer.materials.forEach((m) => m.material.dispose());
  }

  private register(mesh: THREE.Mesh, layer: SystemLayer, material: StatusMaterial): void {
    mesh.userData.systemId = layer.id;
    // Solid tissue first, translucent layers after, the skin last. The same order decides
    // what a click selects: you pick what you can actually see.
    mesh.renderOrder = layer.id === 'radiation' ? 3 : material.kind === 'ghost' ? 2 : 1;
    mesh.userData.pickRank = mesh.renderOrder;
    if (!layer.materials.includes(material)) layer.materials.push(material);
    this.pickables.push(mesh);
  }

  /**
   * The atlas models the spleen and thymus but not lymph nodes, which matter for immune
   * monitoring. They are added at their textbook sites, positioned from the model's own bones.
   */
  private addLymphNodes(lm: Landmarks): void {
    const layer = this.layers.get('immune')!;
    const node = createSolidMaterial({ whiten: 0.08, roughness: 0.4 });
    const vessel = createSolidMaterial({ whiten: 0.18, opacity: 0.85 });
    const at = (key: string): THREE.Vector3 | null => (lm[key] ? v(...lm[key]!) : null);
    const add = (mesh: THREE.Mesh, material: StatusMaterial): void => {
      this.register(mesh, layer, material);
      layer.group.add(mesh);
    };
    const dot = (p: THREE.Vector3, r = 0.011): void => add(ellipsoid(p, v(r, r * 1.3, r), node.material), node);
    const path = (points: (THREE.Vector3 | null)[]): void => {
      const valid = points.filter((p): p is THREE.Vector3 => p !== null);
      if (valid.length >= 2) add(tube(valid, 0.0026, vessel.material), vessel);
    };

    const ductTop = at('ductTop');
    const ductBottom = at('ductBottom');
    path([ductBottom, ductTop]);
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? 1 : -1;
      const neck = at(`neck${side}`);
      const axilla = at(`axilla${side}`);
      const groin = at(`groin${side}`);
      const elbow = at(`elbow${side}`);
      const knee = at(`knee${side}`);
      for (const [p, offset] of [
        [neck, v(0, 0, 0)],
        [neck, v(sign * 0.006, 0.045, -0.008)],
        [axilla, v(0, 0, 0)],
        [axilla, v(-sign * 0.018, -0.03, 0.01)],
        [groin, v(0, 0, 0)],
        [groin, v(sign * 0.02, -0.03, -0.004)],
      ] as [THREE.Vector3 | null, THREE.Vector3][]) {
        if (p) dot(p.clone().add(offset));
      }
      if (elbow) dot(elbow, 0.008);
      if (knee) dot(knee, 0.009);
      path([neck, ductTop]);
      path([at(`wrist${side}`), elbow, axilla, ductTop]);
      path([at(`ankle${side}`), knee, groin, ductBottom]);
    }
  }

  /** The atlas has no inner ear; the balance organs are drawn as three semicircular canals per side. */
  private addInnerEars(lm: Landmarks): void {
    const layer = this.layers.get('sensory')!;
    const material = createSolidMaterial({ whiten: 0.1, roughness: 0.3 });
    const canal = new THREE.TorusGeometry(0.0085, 0.0026, 6, 18);
    for (const key of ['earL', 'earR']) {
      if (!lm[key]) continue;
      const centre = v(...lm[key]!);
      for (const rotation of [new THREE.Euler(0, 0, 0), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Euler(0, Math.PI / 2, 0)]) {
        const ring = new THREE.Mesh(canal, material.material);
        ring.position.copy(centre);
        ring.rotation.copy(rotation);
        this.register(ring, layer, material);
        layer.group.add(ring);
      }
    }
  }
}
