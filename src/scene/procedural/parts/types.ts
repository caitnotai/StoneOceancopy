import * as THREE from 'three';
import type { Vitals } from '../../BodyModel';
import type { StatusMaterial } from '../../materials';

export interface PartBuild {
  group: THREE.Group;
  materials: StatusMaterial[];
  /** Optional per-frame animation (heartbeat, breathing). */
  animate?: (elapsed: number, vitals: Vitals) => void;
}

export function groupOf(name: string, children: THREE.Object3D[]): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.add(...children);
  return group;
}
