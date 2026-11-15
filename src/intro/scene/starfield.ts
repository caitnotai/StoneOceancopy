import * as THREE from 'three';

/**
 * Two layers give the sky its depth: far stars that barely move and twinkle softly, and
 * a sparse veil of nearby dust that slides past as the camera pulls away from Earth.
 */

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uAttenuation;
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aTint;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.78 + 0.22 * sin(uTime * (0.5 + fract(aPhase) * 1.4) + aPhase * 6.2831);
    float size = aSize * uPixelRatio;
    // Dust shrinks with distance and fades out before it reaches the lens.
    float near = uAttenuation > 0.0 ? smoothstep(0.3, 1.6, -mv.z) : 1.0;
    if (uAttenuation > 0.0) size *= clamp(uAttenuation / -mv.z, 0.25, 2.0);
    gl_PointSize = size;
    vTint = aTint;
    vAlpha = twinkle * near;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vTint * a * a * vAlpha * uOpacity, 1.0);
  }
`;

const TINTS = [new THREE.Color(0xffffff), new THREE.Color(0xbfd4ff), new THREE.Color(0x9fc0ff), new THREE.Color(0xffe9cf)];

function layer(count: number, place: (out: THREE.Vector3) => void, sizes: [number, number], opacity: number, attenuation: number) {
  const positions = new Float32Array(count * 3);
  const tints = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    place(p);
    positions.set([p.x, p.y, p.z], i * 3);
    const tint = TINTS[Math.floor(Math.random() * TINTS.length)];
    tints.set([tint.r, tint.g, tint.b], i * 3);
    // Mostly small stars with a few brighter ones.
    size[i] = sizes[0] + (sizes[1] - sizes[0]) * Math.random() ** 3;
    phase[i] = Math.random() * 10;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: opacity },
      uAttenuation: { value: attenuation },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // Additive, without touching the canvas alpha: stars shine over the CSS sky behind.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, geometry, material };
}

export interface Starfield {
  object: THREE.Group;
  update(elapsed: number, pixelRatio: number): void;
  dispose(): void;
}

export function createStarfield(): Starfield {
  const far = layer(1500, (p) => p.randomDirection().multiplyScalar(60 + Math.random() * 60), [1.2, 4.2], 0.85, 0);
  const dust = layer(
    220,
    (p) => p.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 16, -4 + Math.random() * 18),
    [1.5, 3.5],
    0.3,
    4,
  );
  const group = new THREE.Group();
  group.add(far.points, dust.points);

  return {
    object: group,
    update(elapsed, pixelRatio) {
      for (const { material } of [far, dust]) {
        material.uniforms.uTime.value = elapsed;
        material.uniforms.uPixelRatio.value = pixelRatio;
      }
      far.points.rotation.y = elapsed * 0.004;
      far.points.rotation.x = elapsed * 0.0015;
    },
    dispose() {
      for (const { geometry, material } of [far, dust]) {
        geometry.dispose();
        material.dispose();
      }
    },
  };
}
