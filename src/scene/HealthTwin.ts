import { gsap } from 'gsap';
import * as THREE from 'three';
import type { TwinView } from '../domain/twinView';
import type { BodyModel, Vitals } from './BodyModel';
import { breath } from './animation';
import type { AstronautSuit } from './suit/AstronautSuit';
import { HOLOGRAM_COLOR } from './suit/SuitFade';
import type { SystemVisuals } from './SystemVisuals';

/**
 * What each view looks like once it has settled:
 *  - astronaut: the suit, solid; no anatomy;
 *  - scan:      the suit as a hologram over a subdued anatomy, where only the selected system stands out;
 *  - anatomy:   no suit; the anatomy as it normally looks.
 * `suit` is the suit's opacity, `anatomy` how much of the anatomy is revealed, `scan` how subdued it is.
 */
const LOOK: Record<TwinView, { suit: number; anatomy: number; scan: number }> = {
  astronaut: { suit: 1, anatomy: 0, scan: 0 },
  scan: { suit: 0.22, anatomy: 1, scan: 1 },
  anatomy: { suit: 0, anatomy: 1, scan: 0 },
};

const BODY_HEIGHT = 1.8;
/** What a hit on the suit is tagged with. It is not a body system and never reaches the store. */
const SUIT_PICK_ID = 'suit';

/**
 * The crew member's twin: a friendly suit on the outside, the anatomy inside, and the
 * three ways of looking at them (astronaut, scan, anatomy).
 *
 * It owns no health logic and replaces nothing: the anatomy is still a `BodyModel`, picked
 * by `Picker` and colored by `SystemVisuals`. The twin only decides how much of each layer
 * is on show. GSAP eases those few numbers; the scene's own frame loop draws them.
 */
export class HealthTwin {
  /** Holds the suit and the anatomy, so both float and breathe as one figure. */
  readonly root = new THREE.Group();
  private readonly look = { ...LOOK.astronaut };
  private readonly scanRing: THREE.Mesh;
  private readonly scanMaterial: THREE.MeshBasicMaterial;
  private readonly still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly statusColor = new THREE.Color(0x898781);
  private suit: AstronautSuit | null = null;
  private body: BodyModel | null = null;
  private suitTarget: BodyModel | null = null;
  private current: TwinView = 'astronaut';
  private weightless = false;
  private drift = 0;
  private peek = 0;
  private peekTarget = 0;

  constructor(private readonly visuals: SystemVisuals) {
    this.root.name = 'health-twin';
    this.scanMaterial = new THREE.MeshBasicMaterial({
      color: HOLOGRAM_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.scanRing = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.418, 96), this.scanMaterial);
    this.scanRing.rotation.x = -Math.PI / 2;
    this.scanRing.renderOrder = 6;
    this.root.add(this.scanRing);
    this.visuals.setReveal(this.look.anatomy);
    this.visuals.setSubdued(this.look.scan);
  }

  get view(): TwinView {
    return this.current;
  }

  /** True once the anatomy is on show and can be pointed at. */
  get explorable(): boolean {
    return this.current !== 'astronaut' && this.look.anatomy > 0.5;
  }

  /**
   * What the picker should test the pointer against: the suit while the astronaut is on
   * show (a click on it starts the exploration), the anatomy once that is revealed, and
   * nothing in between.
   */
  get pickTarget(): BodyModel | null {
    if (this.current === 'astronaut') return this.suitTarget;
    return this.explorable ? this.body : null;
  }

  setBody(model: BodyModel | null, previous: BodyModel | null): void {
    if (previous) this.root.remove(previous.root);
    if (model) this.root.add(model.root);
    this.body = model;
  }

  setSuit(suit: AstronautSuit): void {
    if (this.suit) {
      this.root.remove(this.suit.root);
      this.suit.dispose();
    }
    this.suit = suit;
    // The picker only knows `BodyModel`: the suit is handed to it in that shape, as one
    // clickable thing with no body systems of its own.
    for (const mesh of suit.pickables) {
      mesh.userData.systemId = SUIT_PICK_ID;
      mesh.userData.pickRank = 0;
    }
    this.suitTarget = { root: suit.root, layers: new Map(), pickables: suit.pickables, update: () => undefined, dispose: () => undefined };
    suit.setStatusColor(this.statusColor);
    suit.setOpacity(this.look.suit);
    this.root.add(suit.root);
  }

  /** The overall status, for the suit's chest light. */
  setStatusColor(color: THREE.Color): void {
    this.statusColor.copy(color);
    this.suit?.setStatusColor(color);
  }

  /** In microgravity the figure drifts a little; under gravity it stands. */
  setWeightless(weightless: boolean): void {
    this.weightless = weightless;
  }

  setView(view: TwinView): void {
    if (view === this.current) return;
    const from = this.current;
    this.current = view;
    this.peekTarget = 0;
    const target = LOOK[view];
    gsap.killTweensOf(this.look);
    if (this.still) {
      Object.assign(this.look, target);
      return;
    }
    if (from === 'astronaut') {
      // The reveal: the suit thins out first, then the anatomy comes up through it, layer by layer.
      gsap
        .timeline()
        .to(this.look, { suit: Math.max(target.suit, LOOK.scan.suit), duration: 0.9, ease: 'power2.inOut' }, 0)
        .set(this.look, { scan: 1 }, 0)
        .to(this.look, { anatomy: 1, duration: 1.9, ease: 'power1.inOut' }, 0.45)
        .to(this.look, { suit: target.suit, scan: target.scan, duration: 0.7, ease: 'power2.out' }, 2.1);
      return;
    }
    gsap.to(this.look, { ...target, duration: view === 'astronaut' ? 1.1 : 0.7, ease: 'power2.inOut' });
  }

  setPeek(peeking: boolean): void {
    this.peekTarget = peeking && this.current === 'astronaut' ? 0.34 : 0;
  }

  update(dt: number, elapsed: number, vitals: Vitals): void {
    this.peek += (this.peekTarget - this.peek) * (this.still ? 1 : 1 - Math.exp(-dt * 5));
    this.visuals.setReveal(Math.max(this.look.anatomy, this.peek));
    this.visuals.setSubdued(this.look.scan);
    this.suit?.setOpacity(Math.min(this.look.suit, 1 - this.peek * 0.5));
    this.suit?.update(elapsed, this.still ? 0 : breath(elapsed, vitals));

    // A slow sweep up and down the body while it is being scanned.
    this.scanRing.visible = this.look.scan > 0.01 && !this.still;
    if (this.scanRing.visible) {
      const sweep = 0.5 - 0.5 * Math.cos(elapsed * 0.9);
      this.scanRing.position.y = 0.04 + sweep * BODY_HEIGHT;
      this.scanMaterial.opacity = 0.8 * this.look.scan * Math.sin(Math.PI * Math.min(1, Math.max(0, sweep))) ** 0.5;
    }

    // Weightless drift: barely there, and eased in and out when the environment changes.
    const wanted = this.weightless && !this.still ? 1 : 0;
    this.drift += (wanted - this.drift) * (1 - Math.exp(-dt * 1.5));
    this.root.position.y = this.drift * (0.03 + 0.012 * Math.sin(elapsed * 0.55));
    this.root.rotation.z = this.drift * 0.012 * Math.sin(elapsed * 0.37 + 1);
    this.root.rotation.x = this.drift * 0.01 * Math.sin(elapsed * 0.29);
  }

  dispose(): void {
    gsap.killTweensOf(this.look);
    this.suit?.dispose();
    this.scanRing.geometry.dispose();
    this.scanMaterial.dispose();
  }
}
