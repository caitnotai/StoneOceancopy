import * as THREE from 'three';

/**
 * A material whose look is driven by a health status. The scene never sets colors on
 * meshes directly; it calls `apply` and each material decides how to show it.
 */
export interface StatusMaterial {
  readonly kind: 'solid' | 'ghost';
  readonly material: THREE.Material;
  /**
   * @param color    current status color
   * @param emphasis 0 = resting, higher = hovered / selected / alarm pulse
   * @param opacity  0..1 multiplier (dimmed systems go low)
   * @param time     seconds, for animated effects
   * @param focus    0..1, how much this system is the selected one (eased)
   */
  apply(color: THREE.Color, emphasis: number, opacity: number, time: number, focus: number): void;
}

const WHITE = new THREE.Color(1, 1, 1);

export interface SolidOptions {
  /** 0..1: how far to wash the status color toward white (bone looks paler than blood). */
  whiten?: number;
  opacity?: number;
  roughness?: number;
}

/** Lit, opaque-looking tissue: bones, organs, vessels. */
export function createSolidMaterial(options: SolidOptions = {}): StatusMaterial {
  const whiten = options.whiten ?? 0;
  const baseOpacity = options.opacity ?? 1;
  const material = new THREE.MeshStandardMaterial({
    roughness: options.roughness ?? 0.55,
    metalness: 0.05,
    transparent: true,
  });
  return {
    kind: 'solid',
    material,
    apply(color, emphasis, opacity) {
      material.color.copy(color).lerp(WHITE, whiten);
      material.emissive.copy(color).lerp(WHITE, whiten * 0.5);
      material.emissiveIntensity = 0.1 + 0.5 * emphasis;
      const o = baseOpacity * opacity;
      material.opacity = o;
      // Dimmed tissue must not hide whatever is behind it.
      material.depthWrite = o > 0.9;
    },
  };
}

export interface VeilOptions {
  /** Opacity while the system is not selected. */
  rest?: number;
  /** Opacity once the system is selected. Below 1 keeps what is inside visible (bronchi in a lung). */
  focused?: number;
  whiten?: number;
  roughness?: number;
}

/**
 * Tissue that wraps other systems (muscle around bone, lung around bronchi). At rest it is
 * a faint lit veil so the inside stays visible; when its system is selected it turns solid.
 */
export function createVeilMaterial(options: VeilOptions = {}): StatusMaterial {
  const rest = options.rest ?? 0.16;
  const focused = options.focused ?? 1;
  const whiten = options.whiten ?? 0;
  const material = new THREE.MeshStandardMaterial({
    roughness: options.roughness ?? 0.6,
    metalness: 0.05,
    transparent: true,
    depthWrite: false,
  });
  return {
    kind: 'ghost',
    material,
    apply(color, emphasis, opacity, _time, focus) {
      material.color.copy(color).lerp(WHITE, whiten);
      material.emissive.copy(color);
      // Once solid, the tissue is shaped by light and shadow, so its own glow steps back.
      material.emissiveIntensity = (0.06 + 0.4 * emphasis) * (1 - 0.75 * focus);
      const o = (rest + (focused - rest) * focus) * opacity;
      material.opacity = o;
      material.depthWrite = o > 0.9;
    },
  };
}

export interface GhostOptions {
  /** Higher = thinner rim. */
  power?: number;
  /** Constant glow added to the rim term. */
  base?: number;
  intensity?: number;
  /** 0..1 strength of the horizontal scan lines. */
  scan?: number;
  scanFrequency?: number;
}

const GHOST_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * world;
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    vWorldY = world.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const GHOST_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPower;
  uniform float uBase;
  uniform float uScan;
  uniform float uScanFrequency;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
    float rim = pow(1.0 - facing, uPower);
    float scan = 1.0 - uScan * (0.5 + 0.5 * sin(vWorldY * uScanFrequency - uTime * 1.6));
    float alpha = clamp((uBase + rim) * uOpacity * scan, 0.0, 1.0);
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** Translucent hologram shell: bright at grazing angles, clear when seen face-on. */
export function createGhostMaterial(options: GhostOptions = {}): StatusMaterial {
  const intensity = options.intensity ?? 1;
  const uniforms = {
    uColor: { value: new THREE.Color() },
    uOpacity: { value: intensity },
    uPower: { value: options.power ?? 2.4 },
    uBase: { value: options.base ?? 0.03 },
    uScan: { value: options.scan ?? 0 },
    uScanFrequency: { value: options.scanFrequency ?? 150 },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: GHOST_VERTEX,
    fragmentShader: GHOST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  return {
    kind: 'ghost',
    material,
    apply(color, emphasis, opacity, time, focus) {
      uniforms.uColor.value.copy(color);
      uniforms.uOpacity.value = intensity * opacity * (0.75 + 0.5 * emphasis + 0.6 * focus);
      uniforms.uTime.value = time;
    },
  };
}
