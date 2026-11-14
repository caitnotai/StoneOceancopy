import type { AppActions } from '../app/actions';
import { MONITORING, usesIndividualBaseline } from '../domain/engine/monitor';
import { verificationWindowMin, type Intervention } from '../domain/engine/verify';
import { evidenceFor } from '../domain/evidence/catalog';
import { BASIS_LABEL, provenanceOf, type AlertProvenance } from '../domain/evidence/indicatorRules';
import { AUTHORITY_LABEL, PROVENANCE_LABEL, VERIFICATION_LABEL, type EvidenceWithSource } from '../domain/evidence/types';
import { offerSteps, WITHHELD_STEP, type MedicalPlan } from '../domain/medicalPlan';
import type { DriftSummary, DriftTrigger, HealthStatus, IndicatorDef, IndicatorEvaluation, MissionMinutes, Range, Reading, Thresholds } from '../domain/types';
import { h, setText } from './dom';
import { formatRange, formatTrend, formatValue, formatWhen, statusBadge, updateBadge } from './format';
import { TrendChart } from './TrendChart';

const TABLE_ROWS = 8;

const TRIGGER_LABEL: Record<DriftTrigger, string> = {
  single_value: 'one value far from your baseline',
  ewma: 'a sustained drift (EWMA)',
  cusum: 'an accumulated change (CUSUM)',
};

const roundRange = (range: Range, decimals: number): Range => ({
  min: Number.isFinite(range.min) ? Number(range.min.toFixed(decimals)) : range.min,
  max: Number.isFinite(range.max) ? Number(range.max.toFixed(decimals)) : range.max,
});

/** What the card needs besides the readings: the medical plan and the latest intervention. */
export interface CardContext {
  plan: MedicalPlan;
  intervention?: Intervention;
}

const sourceLink = (title: string, url: string | null): HTMLElement =>
  url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, title) : h('span', null, title);

function evidenceItem(e: EvidenceWithSource): HTMLElement {
  const facts = [
    PROVENANCE_LABEL[e.provenanceClass],
    e.n === null ? 'n not reported' : `n = ${e.n}`,
    e.effect,
    e.ci95 ? `95% CI ${e.ci95[0]} to ${e.ci95[1]}` : null,
    e.p ? `p ${e.p}` : null,
  ].filter(Boolean);
  return h(
    'li',
    { class: 'evidence-item' },
    h('p', null, e.claim),
    h('p', { class: 'evidence-facts' }, facts.join(' · ')),
    h('p', { class: 'evidence-source' }, sourceLink(e.source.matchedTitle ?? e.source.title, e.source.url), ` · ${VERIFICATION_LABEL[e.verification]}`),
    h('p', { class: 'evidence-limits' }, `Limits: ${e.limitations}`),
  );
}

/**
 * One indicator, laid out as the loop the crew member follows:
 * Detect (value, status and where the threshold comes from), Treat (what to do, by
 * authority level) and Verify (the measured response that closes the action).
 */
export class IndicatorCard {
  readonly element: HTMLElement;
  private readonly chart: TrendChart;
  private readonly provenance: AlertProvenance;
  private readonly value = h('span', { class: 'indicator-value' }, '–');
  private readonly badge = statusBadge('unknown');
  private readonly trend = h('span', { class: 'indicator-trend' });
  private readonly range = h('span', { class: 'indicator-range' });
  private readonly dueChip = h('span', { class: 'chip chip-due', hidden: true }, 'Check due');
  private readonly basis = h('span', { class: 'basis' });
  private readonly reference = h('p');
  private readonly baselineRules = h('p', { class: 'provenance', hidden: true });
  private readonly treat = h('div', { class: 'dtv-body' });
  private readonly verify = h('div', { class: 'dtv-body' });
  private readonly tableBody = h('tbody');
  private readonly input: HTMLInputElement;
  private loopSignature = '';
  private tableSignature = '';

  constructor(private readonly def: IndicatorDef, private readonly actions: AppActions) {
    this.chart = new TrendChart(def);
    this.provenance = provenanceOf(def.id);
    const { provenance } = this;
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

    const evidence = evidenceFor(provenance.rule);
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
      h(
        'ol',
        { class: 'dtv' },
        h(
          'li',
          { class: 'dtv-step' },
          h('h5', null, 'Detect'),
          h(
            'div',
            { class: 'dtv-body' },
            h('p', null, this.basis),
            this.reference,
            this.baselineRules,
            h(
              'p',
              { class: 'provenance' },
              `Evidence: ${PROVENANCE_LABEL[provenance.evidence.provenanceClass]} · `,
              sourceLink(provenance.source.matchedTitle ?? provenance.source.title, provenance.source.url),
            ),
          ),
        ),
        h('li', { class: 'dtv-step' }, h('h5', null, 'Treat'), this.treat),
        h('li', { class: 'dtv-step' }, h('h5', null, 'Verify'), this.verify),
      ),
      h('p', { class: 'indicator-why' }, def.whyItMatters),
      h('details', null, h('summary', null, 'How to measure'), h('p', null, def.howToMeasure)),
      h(
        'details',
        null,
        h('summary', null, `Evidence for this rule (${evidence.length})`),
        h('p', { class: 'reference' }, `${provenance.rule.condition}. ${provenance.rule.incidence}`),
        h('ul', { class: 'evidence-list' }, ...evidence.map(evidenceItem)),
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

  update(evaluation: IndicatorEvaluation, readings: readonly Reading[], thresholds: Thresholds, now: MissionMinutes, context: CardContext): void {
    const { def } = this;
    const { drift } = evaluation;
    const nominal = formatRange(thresholds.nominal, def);
    setText(this.value, evaluation.latest ? formatValue(evaluation.latest.value, def) : '–');
    updateBadge(this.badge, evaluation.status);
    if (drift) setText(this.range, `Your usual range ${formatRange(roundRange(drift.usualRange, def.decimals), def)} ${def.unit}`);
    else setText(this.range, nominal === 'any' ? 'No limit set: tracked only' : `Nominal ${nominal} ${def.unit}`);
    setText(this.trend, evaluation.worsening ? `${formatTrend(evaluation)} · heading out of range` : formatTrend(evaluation));
    this.trend.classList.toggle('is-worsening', evaluation.worsening);
    this.dueChip.hidden = !(evaluation.due && def.acquisition === 'self-check');
    this.element.dataset.status = evaluation.status;
    // Against the baseline, the bands are the single-value limits. They apply to a day's value,
    // so the single readings of a sensor are drawn over them but not judged one by one.
    this.chart.update(readings, drift ? drift.bands : thresholds, now, { status: evaluation.status, pointStatus: !drift || def.cadenceHours > 2 });
    this.renderBasis(drift);
    this.renderLoop(evaluation.status, context, Boolean(drift));
    this.renderTable(readings);
  }

  dispose(): void {
    this.chart.dispose();
  }

  /** Detect: what the value is compared with. The individual baseline replaces the illustrative range once it exists. */
  private renderBasis(drift: DriftSummary | undefined): void {
    const { def, provenance } = this;
    setText(this.basis, drift ? BASIS_LABEL.baseline_individual : provenance.basisLabel);
    this.basis.classList.toggle('basis-nasa', !drift && provenance.nasaLimit);
    this.baselineRules.hidden = !drift;
    if (!drift) {
      const pending = usesIndividualBaseline(def.id) ? ` Your own baseline takes over once ${MONITORING.baselineDays} days have been recorded.` : '';
      setText(this.reference, `${def.reference}${pending}`);
      return;
    }
    const precise = (value: number): string => value.toFixed(def.decimals + 1);
    const signed = (value: number): string => value.toFixed(2).replace('-', '−');
    const sensor = def.cadenceHours <= 2;
    let now = 'No value since the baseline yet.';
    if (drift.awaitingFirstValue) now = 'Waiting for the first value since the treatment; until then the earlier status stands.';
    else if (drift.current) {
      const { value, z } = drift.current;
      const distance = Math.abs(z) < 0.05 ? 'at your baseline' : `${Math.abs(z).toFixed(1)} SD ${z > 0 ? 'above' : 'below'} your baseline`;
      now = `Now ${sensor ? precise(value) : formatValue(value, def)} ${def.unit}${sensor ? ' (mean of the last 24 h)' : ''}: ${distance}.`;
    }
    setText(this.reference, `Compared with your own baseline of ${drift.baselineDays} days: ${precise(drift.baselineMean)} ± ${precise(drift.baselineSd)} ${def.unit}. ${now}`);
    const sign = drift.direction === 'low' ? '−' : drift.direction === 'high' ? '' : '±';
    const flagged = drift.trigger ? ` Flagged by ${TRIGGER_LABEL[drift.trigger]}.` : '';
    setText(
      this.baselineRules,
      `Flag rules: one value beyond ${drift.singleValueCautionLimit.toFixed(1)} SD (critical beyond ${drift.singleValueCriticalLimit.toFixed(1)}) · sustained drift, EWMA ${signed(drift.ewma)} (limit ${sign}${drift.ewmaCautionLimit.toFixed(2)}) · accumulated change, CUSUM ${drift.cusum.toFixed(1)} (limit ${drift.cusumCautionLimit.toFixed(1)}).${flagged}`,
    );
  }

  /** Treat and Verify are rebuilt only when something that affects them changes. */
  private renderLoop(status: HealthStatus, { plan, intervention }: CardContext, againstBaseline: boolean): void {
    const signature = `${status}|${plan.drugsPreauthorized}|${intervention?.id ?? 0}|${intervention?.outcome ?? ''}|${againstBaseline}`;
    if (signature === this.loopSignature) return;
    this.loopSignature = signature;
    const { def, provenance } = this;
    const { rule } = provenance;
    const flagged = status === 'caution' || status === 'critical';

    // ---- Treat ----
    if (!flagged) {
      this.treat.replaceChildren(h('p', { class: 'quiet' }, status === 'nominal' ? 'No action needed.' : 'Waiting for a reading.'));
    } else {
      const immediate = offerSteps(def.guidance[status], plan);
      this.treat.dataset.status = status;
      this.treat.replaceChildren(
        h('p', { class: 'dtv-label' }, status === 'critical' ? 'Act now' : 'First steps'),
        h('ol', { class: 'steps' }, ...immediate.map((s) => h('li', { class: s.withheld ? 'withheld' : '' }, s.text))),
        h('p', { class: 'dtv-label' }, `Protocol: ${rule.condition}`),
        h(
          'ul',
          { class: 'protocol' },
          ...rule.treat.map((step) => {
            const withheld = step.requiresPreauthorization && !plan.drugsPreauthorized;
            return h(
              'li',
              { class: withheld ? 'withheld' : '' },
              h('span', { class: 'level', title: AUTHORITY_LABEL[step.authorityLevel] }, `L${step.authorityLevel}`),
              h('span', { class: 'protocol-text' }, withheld ? WITHHELD_STEP : step.text),
              withheld
                ? null
                : h('button', { class: 'button button-quiet button-small', type: 'button', onclick: () => this.actions.startIntervention(def.id, step.text, step.authorityLevel) }, 'Done'),
            );
          }),
        ),
        ...rule.cautions.map((caution) => h('p', { class: 'caution-note' }, caution)),
      );
    }

    // ---- Verify ----
    const unit = def.unit;
    const shown = (value: number | null): string => (value === null ? 'no value' : `${formatValue(value, def)} ${unit}`);
    const target = againstBaseline ? 'within your usual range' : 'in range';
    const windowHours = Math.round(verificationWindowMin(def, againstBaseline) / 60);
    let state: HTMLElement;
    if (!intervention) {
      state = h('p', { class: 'quiet' }, flagged ? 'No treatment recorded yet. Press “Done” on a step once you have carried it out.' : 'Nothing to verify.');
    } else if (intervention.outcome === 'pending') {
      state = h(
        'p',
        { class: 'verify-state', dataset: { outcome: 'pending' } },
        h('strong', null, 'Waiting for a measured response. '),
        `“${intervention.stepText}” was done at ${formatWhen(intervention.startedAt)} with ${shown(intervention.valueBefore)}. It closes when this indicator is measured back ${target}, within ${windowHours} h.`,
      );
    } else if (intervention.outcome === 'verified') {
      state = h(
        'p',
        { class: 'verify-state', dataset: { outcome: 'verified' } },
        h('strong', null, '● Verified. '),
        `${shown(intervention.valueBefore)} before, ${shown(intervention.valueAfter)} at ${formatWhen(intervention.checkedAt ?? intervention.startedAt)}: back ${target} after “${intervention.stepText}”`,
      );
    } else {
      state = h(
        'p',
        { class: 'verify-state', dataset: { outcome: 'not_verified' } },
        h('strong', null, '◆ Not verified. '),
        `Still out of range (${shown(intervention.valueAfter)}) ${windowHours} h after “${intervention.stepText}”. Move to the next authority level.`,
      );
    }
    this.verify.replaceChildren(h('p', null, rule.verify.criterion), state);
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
