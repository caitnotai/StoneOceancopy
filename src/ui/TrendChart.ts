import { classify } from '../domain/engine/evaluate';
import { STATUS_COLOR, STATUS_GLYPH, STATUS_LABEL } from '../domain/status';
import type { IndicatorDef, MissionMinutes, Reading, Thresholds } from '../domain/types';
import { h } from './dom';
import { formatValue, formatWhen } from './format';

const WINDOW_DAYS = 7;
const MINUTES_PER_DAY = 1440;
const HEIGHT = 136;
const PAD = { left: 38, right: 12, top: 10, bottom: 22 };
const SPARSE_LIMIT = 16;

const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * 7-day trend of one indicator. Background bands show the nominal / caution / critical
 * zones, so the reader sees not only the value but how far it is from trouble.
 * Single series: the card title names it, so there is no legend box.
 */
export class TrendChart {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly tip: HTMLDivElement;
  private readonly observer: ResizeObserver;
  private readings: readonly Reading[] = [];
  private thresholds: Thresholds;
  private now: MissionMinutes = 0;
  private hovered: Reading | null = null;
  private width = 0;

  constructor(private readonly def: IndicatorDef) {
    this.thresholds = def.thresholds;
    this.canvas = h('canvas', { class: 'chart-canvas', role: 'img' });
    this.tip = h('div', { class: 'chart-tip', hidden: true });
    this.element = h('div', { class: 'chart' }, this.canvas, this.tip);
    this.canvas.addEventListener('pointermove', (e) => this.onPointer(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.tip.hidden = true;
      this.draw();
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.element);
  }

  update(readings: readonly Reading[], thresholds: Thresholds, now: MissionMinutes): void {
    this.readings = readings;
    this.thresholds = thresholds;
    this.now = now;
    const latest = readings[readings.length - 1];
    this.canvas.setAttribute(
      'aria-label',
      latest
        ? `${this.def.name}, last ${WINDOW_DAYS} days. Latest ${formatValue(latest.value, this.def)} ${this.def.unit}, ${STATUS_LABEL[classify(latest.value, thresholds)]}.`
        : `${this.def.name}: no readings yet.`,
    );
    this.draw();
  }

  dispose(): void {
    this.observer.disconnect();
  }

  private resize(): void {
    const width = Math.floor(this.element.clientWidth);
    if (width === this.width || width === 0) return;
    this.width = width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    this.canvas.style.height = `${HEIGHT}px`;
    this.draw();
  }

  private get startTime(): MissionMinutes {
    return this.now - WINDOW_DAYS * MINUTES_PER_DAY;
  }

  private xOf(t: MissionMinutes): number {
    const plot = this.width - PAD.left - PAD.right;
    return PAD.left + ((t - this.startTime) / (WINDOW_DAYS * MINUTES_PER_DAY)) * plot;
  }

  private yOf(value: number): number {
    const { min, max } = this.def.display;
    const clamped = Math.min(max, Math.max(min, value));
    return PAD.top + (1 - (clamped - min) / (max - min)) * (HEIGHT - PAD.top - PAD.bottom);
  }

  private visible(): Reading[] {
    const start = this.startTime;
    const firstInside = this.readings.findIndex((r) => r.t >= start);
    if (firstInside < 0) return [];
    // One reading before the window keeps the line running to the left edge.
    return this.readings.slice(Math.max(0, firstInside - 1));
  }

  private onPointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const points = this.visible();
    let best: Reading | null = null;
    let bestDistance = Infinity;
    for (const r of points) {
      const d = Math.abs(this.xOf(r.t) - x);
      if (d < bestDistance) {
        bestDistance = d;
        best = r;
      }
    }
    this.hovered = best;
    if (best) {
      const status = classify(best.value, this.thresholds);
      this.tip.replaceChildren(
        h('strong', null, `${formatValue(best.value, this.def)} ${this.def.unit}`),
        h('span', null, formatWhen(best.t)),
        h(
          'span',
          { class: 'chart-tip-status' },
          h('span', { class: 'status-glyph', dataset: { status } }, STATUS_GLYPH[status]),
          `${STATUS_LABEL[status]}${best.source === 'manual' ? ' · logged by hand' : ''}`,
        ),
      );
      this.tip.hidden = false;
      const px = this.xOf(best.t);
      const flip = px > this.width - 150;
      this.tip.style.transform = `translate(${flip ? px - 142 : px + 10}px, ${Math.max(0, this.yOf(best.value) - 54)}px)`;
    } else {
      this.tip.hidden = true;
    }
    this.draw();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || this.width === 0) return;
    const dpr = this.canvas.width / this.width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, HEIGHT);

    const surface = css('--surface-2');
    const muted = css('--muted');
    const grid = css('--grid');
    const series = css('--series');
    const x0 = PAD.left;
    const x1 = this.width - PAD.right;
    const { display } = this.def;
    const { nominal, caution } = this.thresholds;

    // Status zones (a wash, never a saturated block).
    const zone = (from: number, to: number, color: string): void => {
      const a = Math.max(display.min, from);
      const b = Math.min(display.max, to);
      if (b <= a) return;
      ctx.globalAlpha = 0.11;
      ctx.fillStyle = color;
      ctx.fillRect(x0, this.yOf(b), x1 - x0, this.yOf(a) - this.yOf(b));
      ctx.globalAlpha = 1;
    };
    zone(display.min, caution.min, STATUS_COLOR.critical);
    zone(caution.max, display.max, STATUS_COLOR.critical);
    zone(caution.min, nominal.min, STATUS_COLOR.caution);
    zone(nominal.max, caution.max, STATUS_COLOR.caution);
    zone(nominal.min, nominal.max, STATUS_COLOR.nominal);

    // Zone boundaries double as gridlines; labels sit on the axis in muted ink.
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const ticks = [display.min, display.max, nominal.min, nominal.max, caution.min, caution.max].filter(
      (value) => Number.isFinite(value) && value >= display.min && value <= display.max,
    );
    const placed: number[] = [];
    for (const value of ticks) {
      const y = this.yOf(value);
      if (placed.some((other) => Math.abs(other - y) < 13)) continue;
      placed.push(y);
      ctx.fillStyle = surface;
      ctx.fillRect(x0, Math.round(y) - 0.5, x1 - x0, 1);
      ctx.fillStyle = grid;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x0, Math.round(y) - 0.5, x1 - x0, 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = muted;
      ctx.fillText(String(value), x0 - 6, y);
    }

    // Time axis: one label every other mission day.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const lastDay = Math.floor(this.now / MINUTES_PER_DAY);
    for (let day = lastDay; day * MINUTES_PER_DAY >= this.startTime; day -= 2) {
      const x = this.xOf(day * MINUTES_PER_DAY);
      if (x < x0 + 14 || x > x1 - 14) continue;
      ctx.fillStyle = grid;
      ctx.fillRect(Math.round(x) - 0.5, HEIGHT - PAD.bottom, 1, 4);
      ctx.fillStyle = muted;
      ctx.fillText(`Day ${day + 1}`, x, HEIGHT - 5);
    }

    const points = this.visible();
    if (points.length === 0) {
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.fillText('No readings in the last 7 days', (x0 + x1) / 2, HEIGHT / 2);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0 + 6, HEIGHT);
    ctx.clip();
    ctx.beginPath();
    points.forEach((r, i) => {
      const x = this.xOf(r.t);
      const y = this.yOf(r.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = series;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    const dot = (r: Reading, radius: number): void => {
      ctx.beginPath();
      ctx.arc(this.xOf(r.t), this.yOf(r.value), radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(this.xOf(r.t), this.yOf(r.value), radius, 0, Math.PI * 2);
      ctx.fillStyle = series;
      ctx.fill();
    };
    if (points.length <= SPARSE_LIMIT) points.forEach((r) => dot(r, 4));
    dot(points[points.length - 1], 4);
    ctx.restore();

    if (this.hovered) {
      const x = this.xOf(this.hovered.t);
      ctx.fillStyle = muted;
      ctx.fillRect(Math.round(x) - 0.5, PAD.top, 1, HEIGHT - PAD.top - PAD.bottom);
      dot(this.hovered, 5);
    }
  }
}
