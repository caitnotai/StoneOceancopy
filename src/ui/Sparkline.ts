import type { MissionMinutes, Reading } from '../domain/types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 100;
const HEIGHT = 26;
const WINDOW_MIN = 7 * 1440;
const MAX_POINTS = 48;

/** A tiny, axis-free trace of the last 7 days: the shape of the trend, nothing more. Decorative (the value is in text beside it). */
export class Sparkline {
  readonly element: SVGSVGElement;
  private readonly line: SVGPolylineElement;
  private signature = '';

  constructor() {
    this.element = document.createElementNS(SVG_NS, 'svg');
    this.element.setAttribute('class', 'sparkline');
    this.element.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
    this.element.setAttribute('preserveAspectRatio', 'none');
    this.element.setAttribute('aria-hidden', 'true');
    this.line = document.createElementNS(SVG_NS, 'polyline');
    this.element.append(this.line);
  }

  update(readings: readonly Reading[], now: MissionMinutes): void {
    const last = readings[readings.length - 1];
    // Redrawn at most every 10 simulated minutes: the shape does not change faster than that.
    const signature = last ? `${readings.length}:${last.t}:${Math.floor(now / 10)}` : '';
    if (signature === this.signature) return;
    this.signature = signature;

    const start = now - WINDOW_MIN;
    const first = readings.findIndex((r) => r.t >= start);
    const visible = first < 0 ? [] : readings.slice(first);
    this.element.toggleAttribute('data-empty', visible.length < 2);
    if (visible.length < 2) {
      this.line.setAttribute('points', '');
      return;
    }
    // Bucket means keep a dense sensor trace readable at this size.
    const size = Math.ceil(visible.length / MAX_POINTS);
    const points: { t: number; value: number }[] = [];
    for (let i = 0; i < visible.length; i += size) {
      const bucket = visible.slice(i, i + size);
      points.push({ t: bucket[bucket.length - 1].t, value: bucket.reduce((sum, r) => sum + r.value, 0) / bucket.length });
    }
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      min = Math.min(min, p.value);
      max = Math.max(max, p.value);
    }
    const span = max - min || 1;
    const xy = points.map((p) => [((p.t - start) / WINDOW_MIN) * (WIDTH - 4) + 2, HEIGHT - 3 - ((p.value - min) / span) * (HEIGHT - 6)]);
    this.line.setAttribute('points', xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  }
}
