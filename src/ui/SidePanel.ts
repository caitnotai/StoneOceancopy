import type { AppActions } from '../app/actions';
import type { HealthStore } from '../data/HealthStore';
import { formatDelay } from '../domain/catalog/environments';
import { HAZARDS } from '../domain/catalog/systems';
import { thresholdsFor } from '../domain/engine/evaluate';
import { severity, STATUS_GLYPH } from '../domain/status';
import type { Evaluation, IndicatorEvaluation, SystemEvaluation, SystemId } from '../domain/types';
import { h, setText, syncList } from './dom';
import { formatValue, statusBadge, updateBadge } from './format';
import { IndicatorCard } from './IndicatorCard';

const TRIAGE_ICON: Record<string, string> = {
  nominal: '●',
  'self-care': '▲',
  'crew-medical': '▲',
  'ground-consult': '◆',
};

/** Right column: the triage verdict, then either the mission overview or one system in detail. */
export class SidePanel {
  private readonly triage = h('section', { class: 'triage', 'aria-live': 'polite' });
  private readonly triageIcon = h('span', { class: 'triage-icon', 'aria-hidden': 'true' });
  private readonly triageHeadline = h('h2');
  private readonly triageDetail = h('p');
  private readonly triageLink = h('p', { class: 'triage-link' });
  private readonly body = h('div', { class: 'panel-body' });
  private view: { update(evaluation: Evaluation): void; dispose(): void } | null = null;

  constructor(parent: HTMLElement, private readonly store: HealthStore, private readonly actions: AppActions) {
    this.triage.append(
      this.triageIcon,
      h('div', null, h('span', { class: 'eyebrow' }, 'What should I do?'), this.triageHeadline, this.triageDetail, this.triageLink),
    );
    parent.append(this.triage, this.body);
    store.events.on('selection', (id) => this.show(id));
    store.events.on('data', (evaluation) => this.update(evaluation));
    this.show(store.selected);
  }

  private show(id: SystemId | null): void {
    this.view?.dispose();
    this.body.replaceChildren();
    this.body.scrollTop = 0;
    this.view = id ? new SystemDetail(this.body, id, this.store, this.actions) : new Overview(this.body, this.store);
    this.update(this.store.evaluation);
  }

  private update(evaluation: Evaluation): void {
    const { triage } = evaluation;
    const env = this.store.environment;
    this.triage.dataset.status = triage.status;
    setText(this.triageIcon, TRIAGE_ICON[triage.level]);
    setText(this.triageHeadline, triage.headline);
    setText(this.triageDetail, triage.detail);
    setText(this.triageLink, `${env.name} · signal to Earth takes ${formatDelay(env.commsDelaySec)} each way`);
    this.view?.update(evaluation);
  }
}

/** Shown when nothing is selected: what needs attention, which checks are due, where we are. */
class Overview {
  private readonly attention = h('div', { class: 'row-list' });
  private readonly attentionEmpty = h('p', { class: 'empty' }, 'Nothing needs attention. Select a body system to see its indicators.');
  private readonly due = h('div', { class: 'row-list' });
  private readonly dueEmpty = h('p', { class: 'empty' }, 'All scheduled self-checks are up to date.');
  private readonly environment = h('div', { class: 'facts' });

  constructor(parent: HTMLElement, private readonly store: HealthStore) {
    parent.append(
      h('section', null, h('h3', null, 'Needs attention'), this.attention, this.attentionEmpty),
      h('section', null, h('h3', null, 'Self-checks due'), this.due, this.dueEmpty),
      h('section', null, h('h3', null, 'Mission environment'), this.environment),
      h(
        'section',
        { class: 'about' },
        h('h3', null, 'About this prototype'),
        h(
          'p',
          null,
          'All readings come from a built-in simulator. Reference ranges are illustrative and would be set by flight surgeons for a real mission. This is a concept for crew decision support, not a medical device.',
        ),
        h(
          'p',
          null,
          'Body systems and risks follow the NASA Human Research Program. Built for the NASA Space Apps Challenge 2026; source code written with AI assistance.',
        ),
        h(
          'p',
          null,
          '3D anatomy: ',
          h('a', { href: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html', target: '_blank', rel: 'noopener' }, 'BodyParts3D'),
          ', © The Database Center for Life Science, licensed under CC Attribution 4.0 International. Meshes were simplified and grouped by body system; lung outlines, lymph nodes and inner ears were added.',
        ),
      ),
    );
  }

  update(evaluation: Evaluation): void {
    const { store } = this;
    const flagged = Object.values(evaluation.systems)
      .filter((s) => severity(s.status) >= severity('caution'))
      .sort((a, b) => severity(b.status) - severity(a.status));
    this.attentionEmpty.hidden = flagged.length > 0;
    syncList<SystemEvaluation>(
      this.attention,
      flagged,
      (s) => s.def.id,
      (s) =>
        h(
          'button',
          { class: 'row', type: 'button', onclick: () => store.select(s.def.id) },
          h('span', { class: 'status-glyph', 'aria-hidden': 'true' }),
          h('span', { class: 'row-text' }, h('strong', null, s.def.name), h('span', { class: 'row-sub' }), h('span', { class: 'row-action' })),
        ),
      (el, s) => {
        el.dataset.status = s.status;
        setText(el.querySelector('.status-glyph')!, STATUS_GLYPH[s.status]);
        const driver = s.driver;
        setText(
          el.querySelector('.row-sub')!,
          driver?.latest ? `${driver.def.name}: ${formatValue(driver.latest.value, driver.def)} ${driver.def.unit}` : '',
        );
        const steps = s.status === 'critical' ? driver?.def.guidance.critical : driver?.def.guidance.caution;
        setText(el.querySelector('.row-action')!, steps?.[0] ? `First step: ${steps[0]}` : '');
      },
    );

    this.dueEmpty.hidden = evaluation.due.length > 0;
    syncList<IndicatorEvaluation>(
      this.due,
      evaluation.due,
      (i) => i.def.id,
      (i) =>
        h(
          'button',
          { class: 'row', type: 'button', onclick: () => store.select(i.def.systemId) },
          h('span', { class: 'status-glyph', 'aria-hidden': 'true' }, '○'),
          h('span', { class: 'row-text' }, h('strong', null, i.def.name), h('span', { class: 'row-sub' }, `Due every ${i.def.cadenceHours} h · open to log it`)),
        ),
      () => undefined,
    );

    const env = store.environment;
    const signature = env.id;
    if (this.environment.dataset.env !== signature) {
      this.environment.dataset.env = signature;
      this.environment.replaceChildren(
        h('p', null, h('strong', null, env.name), ` ${env.description}`),
        h(
          'dl',
          null,
          h('dt', null, 'Gravity'),
          h('dd', null, env.gravityG === 0 ? 'Microgravity' : `${env.gravityG} g`),
          h('dt', null, 'Signal delay'),
          h('dd', null, `${formatDelay(env.commsDelaySec)} one way`),
          h('dt', null, 'Radiation'),
          h('dd', null, `${env.radiationMSvPerDay} mSv/day`),
        ),
        h('p', { class: 'reference' }, env.radiationReference),
      );
    }
  }

  dispose(): void {}
}

/** One body system: why it matters in space, its NASA risks, and a card per indicator. */
class SystemDetail {
  private readonly badge = statusBadge('unknown');
  private readonly cards = new Map<string, IndicatorCard>();

  constructor(parent: HTMLElement, private readonly id: SystemId, private readonly store: HealthStore, actions: AppActions) {
    const system = store.evaluation.systems[id];
    const def = system.def;
    const cards = system.indicators.map((indicator) => {
      const card = new IndicatorCard(indicator.def, actions);
      this.cards.set(indicator.def.id, card);
      return card.element;
    });

    parent.append(
      h(
        'section',
        { class: 'system-head' },
        h('button', { class: 'link-button', type: 'button', onclick: () => store.select(null) }, '← All systems'),
        h('div', { class: 'system-title' }, h('h3', null, def.name), this.badge),
        h('p', null, def.role),
        h('p', null, h('strong', null, 'In space: '), def.spaceflightEffect),
        h(
          'div',
          { class: 'chips' },
          ...def.hazards.map((hazard) =>
            h('a', { class: 'chip', href: HAZARDS[hazard].url, target: '_blank', rel: 'noopener' }, `Hazard: ${HAZARDS[hazard].name}`),
          ),
        ),
        h(
          'ul',
          { class: 'links' },
          ...def.risks.map((risk) => h('li', null, h('a', { href: risk.url, target: '_blank', rel: 'noopener' }, risk.name))),
        ),
        h(
          'p',
          { class: 'zone-legend' },
          'Chart bands: ',
          h('span', { class: 'swatch', dataset: { status: 'nominal' } }),
          'nominal ',
          h('span', { class: 'swatch', dataset: { status: 'caution' } }),
          'caution ',
          h('span', { class: 'swatch', dataset: { status: 'critical' } }),
          'critical',
        ),
      ),
      ...cards,
    );
  }

  update(evaluation: Evaluation): void {
    const system = evaluation.systems[this.id];
    updateBadge(this.badge, system.status);
    for (const indicator of system.indicators) {
      this.cards
        .get(indicator.def.id)
        ?.update(indicator, this.store.history(indicator.def.id), thresholdsFor(indicator.def, this.store.environment), evaluation.missionTime);
    }
  }

  dispose(): void {
    this.cards.forEach((card) => card.dispose());
  }
}
