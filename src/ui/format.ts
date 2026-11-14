import { formatMissionTime } from '../data/MissionClock';
import { STATUS_GLYPH, STATUS_LABEL } from '../domain/status';
import type { HealthStatus, IndicatorDef, IndicatorEvaluation, MissionMinutes, Range } from '../domain/types';
import { h } from './dom';

export const formatValue = (value: number, def: IndicatorDef): string => value.toFixed(def.decimals);

/** "50–100", "≥ 45" or "≤ 2", depending on which ends of the range are open. */
export function formatRange(range: Range, def: IndicatorDef): string {
  const openTop = !Number.isFinite(range.max) || range.max >= def.display.max;
  const openBottom = !Number.isFinite(range.min) || range.min <= def.display.min;
  if (openTop && openBottom) return 'any';
  if (openTop) return `≥ ${range.min}`;
  if (openBottom) return `≤ ${range.max}`;
  return `${range.min}–${range.max}`;
}

export function formatTrend(evaluation: IndicatorEvaluation): string {
  const slope = evaluation.trendPerDay;
  if (slope === null) return 'Trend: not enough data';
  const span = evaluation.def.display.max - evaluation.def.display.min;
  // Below ~3% of the scale per day is measurement noise, not a trend.
  if (Math.abs(slope) < span * 0.03) return 'Steady';
  const amount = Math.abs(slope).toFixed(Math.max(1, evaluation.def.decimals));
  return `${slope > 0 ? 'Rising' : 'Falling'} ${amount} per day`;
}

export function formatWhen(t: MissionMinutes): string {
  const { day, clock } = formatMissionTime(t);
  return `Day ${day} · ${clock}`;
}

/** Status badge: glyph + label, so status never relies on color alone. */
export function statusBadge(status: HealthStatus): HTMLSpanElement {
  return h(
    'span',
    { class: 'badge', dataset: { status } },
    h('span', { class: 'status-glyph', 'aria-hidden': 'true' }, STATUS_GLYPH[status]),
    STATUS_LABEL[status],
  );
}

export function updateBadge(badge: HTMLElement, status: HealthStatus): void {
  if (badge.dataset.status === status) return;
  badge.dataset.status = status;
  badge.replaceChildren(
    h('span', { class: 'status-glyph', 'aria-hidden': 'true' }, STATUS_GLYPH[status]),
    STATUS_LABEL[status],
  );
}
