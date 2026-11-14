import type { AppActions } from '../app/actions';
import type { HealthStatus, IndicatorDef, IndicatorEvaluation, MissionMinutes, Reading, Thresholds } from '../domain/types';
import { h, setText } from './dom';
import { formatRange, formatTrend, formatValue, formatWhen, statusBadge, updateBadge } from './format';
import { TrendChart } from './TrendChart';

const TABLE_ROWS = 8;

/** One indicator: value, status, trend chart, what to do, how to measure, and a log form. */
export class IndicatorCard {
  readonly element: HTMLElement;
  private readonly chart: TrendChart;
  private readonly value = h('span', { class: 'indicator-value' }, '–');
  private readonly badge = statusBadge('unknown');
  private readonly trend = h('span', { class: 'indicator-trend' });
  private readonly range = h('span', { class: 'indicator-range' });
  private readonly dueChip = h('span', { class: 'chip chip-due', hidden: true }, 'Check due');
  private readonly guidance = h('div', { class: 'guidance', hidden: true });
  private readonly tableBody = h('tbody');
  private readonly input: HTMLInputElement;
  private guidanceStatus: HealthStatus | null = null;
  private tableSignature = '';

  constructor(private readonly def: IndicatorDef, actions: AppActions) {
    this.chart = new TrendChart(def);
    const step = def.decimals > 0 ? 1 / 10 ** def.decimals : 1;
    this.input = h('input', {
      type: 'number',
      id: `log-${def.id}`,
      min: String(def.display.min),
      max: String(def.display.max),
      step: String(step),
      placeholder: def.unit,
      required: true,
    });

    const form = h(
      'form',
      {
        class: 'log-form',
        onsubmit: (event: Event) => {
          event.preventDefault();
          const value = Number(this.input.value);
          if (this.input.value === '' || !Number.isFinite(value)) return;
          actions.logReading(def.id, Math.min(def.display.max, Math.max(def.display.min, value)));
          this.input.value = '';
        },
      },
      h('label', { for: `log-${def.id}` }, 'Log a measurement'),
      this.input,
      h('button', { type: 'submit', class: 'button' }, 'Log'),
    );

    this.element = h(
      'article',
      { class: 'indicator-card' },
      h(
        'header',
        { class: 'indicator-head' },
        h('h4', null, def.name),
        h('span', { class: 'chip' }, def.acquisition === 'sensor' ? 'Sensor' : 'Self-check'),
        this.dueChip,
      ),
      h('div', { class: 'indicator-reading' }, h('div', { class: 'indicator-figure' }, this.value, h('span', { class: 'indicator-unit' }, def.unit)), this.badge),
      h('div', { class: 'indicator-meta' }, this.range, this.trend),
      this.chart.element,
      this.guidance,
      h('p', { class: 'indicator-why' }, def.whyItMatters),
      h(
        'details',
        null,
        h('summary', null, 'How to measure'),
        h('p', null, def.howToMeasure),
        h('p', { class: 'reference' }, `Reference range: ${def.reference}`),
      ),
      h(
        'details',
        null,
        h('summary', null, 'Recent readings'),
        h(
          'table',
          { class: 'readings-table' },
          h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, def.unit), h('th', null, 'Source'))),
          this.tableBody,
        ),
      ),
      form,
    );
  }

  update(evaluation: IndicatorEvaluation, readings: readonly Reading[], thresholds: Thresholds, now: MissionMinutes): void {
    const { def } = this;
    setText(this.value, evaluation.latest ? formatValue(evaluation.latest.value, def) : '–');
    updateBadge(this.badge, evaluation.status);
    setText(this.range, `Nominal ${formatRange(thresholds.nominal, def)} ${def.unit}`);
    setText(this.trend, evaluation.worsening ? `${formatTrend(evaluation)} · heading out of range` : formatTrend(evaluation));
    this.trend.classList.toggle('is-worsening', evaluation.worsening);
    this.dueChip.hidden = !(evaluation.due && def.acquisition === 'self-check');
    this.element.dataset.status = evaluation.status;
    this.chart.update(readings, thresholds, now);
    this.renderGuidance(evaluation.status);
    this.renderTable(readings);
  }

  dispose(): void {
    this.chart.dispose();
  }

  private renderGuidance(status: HealthStatus): void {
    if (status === this.guidanceStatus) return;
    this.guidanceStatus = status;
    const actions = status === 'caution' ? this.def.guidance.caution : status === 'critical' ? this.def.guidance.critical : null;
    this.guidance.hidden = !actions;
    this.guidance.dataset.status = status;
    if (!actions) return;
    this.guidance.replaceChildren(
      h('h5', null, status === 'critical' ? 'Act now' : 'What to do'),
      h('ol', null, ...actions.map((action) => h('li', null, action))),
    );
  }

  private renderTable(readings: readonly Reading[]): void {
    const recent = readings.slice(-TABLE_ROWS).reverse();
    const signature = recent.map((r) => `${r.t}:${r.value}`).join('|');
    if (signature === this.tableSignature) return;
    this.tableSignature = signature;
    this.tableBody.replaceChildren(
      ...recent.map((r) =>
        h(
          'tr',
          null,
          h('td', null, formatWhen(r.t)),
          h('td', null, formatValue(r.value, this.def)),
          h('td', null, r.source === 'manual' ? 'Logged by hand' : r.source === 'sensor' ? 'Sensor' : 'Simulated'),
        ),
      ),
    );
  }
}
