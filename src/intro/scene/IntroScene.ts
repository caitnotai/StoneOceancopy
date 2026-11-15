import * as THREE from 'three';
import { createAstronaut } from './astronaut';
import { createEarth } from './earth';
import { createStarfield } from './starfield';

/**
 * Everything the choreography can move. GSAP tweens these plain numbers and the scene
 * reads them every frame, so the timeline never touches Three.js objects directly.
 *
 * Screen positions are fractions of the half-viewport (0 = center, 1 = edge), which keeps
 * the composition the same in landscape and portrait.
 */
export interface IntroSceneState {
  /** Camera distance from the Earth's center (Earth radius = 1). */
  distance: number;
  /** Camera orbit angles, in radians. */
  azimuth: number;
  elevation: number;
  /** Where the Earth sits on screen: + is right / up. */
  earthX: number;
  earthY: number;
  /** Earth brightness, 0..1. */
  earthLight: number;
  /** Where the astronaut floats on screen, and how large. */
  astronautX: number;
  astronautY: number;
  astronautScale: number;
}

const FOV = 40;
const ASTRONAUT_DEPTH = 3.4;

export class IntroScene {
  readonly state: IntroSceneState = {
    distance: 2.45,
    azimuth: -0.55,
    elevation: 0.14,
    earthX: 0,
    earthY: 0,
    earthLight: 1,
    astronautX: -1.7,
    astronautY: -1.3,
    astronautScale: 0.5,
  };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
  private readonly timer = new THREE.Timer();
  private readonly earth;
  private readonly stars;
  private readonly astronaut;
  private readonly resizeObserver: ResizeObserver;
  private readonly pointer = new THREE.Vector2();
  private readonly drift = new THREE.Vector2();
  private frame = 0;
  private disposed = false;

  /** `animate: false` renders still frames only (reduced motion): call `render()` after changing the state. */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly animate: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);

    const sun = new THREE.Vector3(-0.62, 0.36, 0.7).normalize();
    this.earth = createEarth(sun);
    this.stars = createStarfield();
    this.astronaut = createAstronaut(sun);
    this.scene.add(this.earth.object, this.stars.object, this.camera);
    // The astronaut rides with the camera, so it keeps its place in the frame.
    this.camera.add(this.astronaut.object);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    if (animate) window.addEventListener('pointermove', this.onPointerMove);
  }

  start(): void {
    if (!this.animate) {
      this.render();
      return;
    }
    const loop = (time: number): void => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      this.timer.update(time);
      this.render();
    };
    this.frame = requestAnimationFrame(loop);
  }

  render(): void {
    if (this.disposed) return;
    const s = this.state;
    const elapsed = this.animate ? this.timer.getElapsed() : 0;
    const camera = this.camera;

    // A touch of parallax from the pointer keeps the scene alive without asking for attention.
    this.drift.lerp(this.pointer, 0.04);
    const azimuth = s.azimuth + this.drift.x * 0.035;
    const elevation = s.elevation - this.drift.y * 0.025;

    camera.position
      .set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation))
      .multiplyScalar(s.distance);
    camera.lookAt(0, 0, 0);
    // Sliding the camera sideways moves the Earth across the frame without distorting it.
    const halfHeight = s.distance * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.translateX(-s.earthX * halfHeight * camera.aspect);
    camera.translateY(-s.earthY * halfHeight);

    const astronautHalfHeight = ASTRONAUT_DEPTH * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    // In portrait there is less room beside the Earth: keep the figure smaller.
    const fit = Math.min(1, 0.55 + 0.45 * camera.aspect);
    this.astronaut.object.position.set(
      s.astronautX * astronautHalfHeight * camera.aspect,
      s.astronautY * astronautHalfHeight,
      -ASTRONAUT_DEPTH,
    );
    this.astronaut.object.scale.setScalar(s.astronautScale * fit);

    this.earth.setDim(s.earthLight);
    this.earth.update(elapsed);
    this.stars.update(elapsed, this.renderer.getPixelRatio());
    this.astronaut.update(elapsed);
    this.renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.resizeObserver.disconnect();
    this.earth.dispose();
    this.stars.dispose();
    this.astronaut.dispose();
    this.renderer.dispose();
    // Free the GPU context right away: the dashboard's own 3D view is about to need it.
    this.renderer.forceContextLoss();
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointer.set((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
  };

  private resize(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.animate) this.render();
  }
}
