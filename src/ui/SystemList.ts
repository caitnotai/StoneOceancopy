import type { HealthStore } from '../data/HealthStore';
import { STATUS_GLYPH, STATUS_LABEL } from '../domain/status';
import { SYSTEM_IDS, type SystemEvaluation } from '../domain/types';
import { h, setText, syncList } from './dom';
import { formatValue } from './format';

function summary(system: SystemEvaluation): string {
  const driver = system.driver;
  if (!driver?.latest) return 'No data yet';
  return `${driver.def.name}: ${formatValue(driver.latest.value, driver.def)} ${driver.def.unit}`;
}

/** Left column: every body system with its live status. Mirrors the 3D body. */
export class SystemList {
  private readonly list = h('div', { class: 'system-list' });

  constructor(parent: HTMLElement, private readonly store: HealthStore) {
    parent.append(h('h2', { class: 'section-title' }, 'Body systems'), this.list);
    const render = (): void => this.render();
    store.events.on('data', render);
    store.events.on('selection', render);
    store.events.on('hover', render);
    store.events.on('visibility', render);
    render();
  }

  private render(): void {
    const { store } = this;
    const systems = SYSTEM_IDS.map((id) => store.evaluation.systems[id]);
    syncList(
      this.list,
      systems,
      (s) => s.def.id,
      (s) => {
        const id = s.def.id;
        return h(
          'div',
          { class: 'system-row' },
          h(
            'button',
            {
              class: 'system-main',
              type: 'button',
              onclick: () => store.select(store.selected === id ? null : id),
              onpointerenter: () => store.hover(id),
              onpointerleave: () => store.hover(null),
            },
            h('span', { class: 'status-glyph', 'aria-hidden': 'true' }),
            h('span', { class: 'system-text' }, h('span', { class: 'system-name' }, s.def.name), h('span', { class: 'system-summary' })),
            h('span', { class: 'system-status' }),
          ),
          h(
            'button',
            { class: 'layer-toggle', type: 'button', onclick: () => store.toggleVisibility(id) },
            h('span', { 'aria-hidden': 'true' }),
          ),
        );
      },
      (el, s) => {
        const id = s.def.id;
        const hidden = store.hidden.has(id);
        el.dataset.status = s.status;
        el.classList.toggle('is-selected', store.selected === id);
        el.classList.toggle('is-hovered', store.hovered === id);
        el.classList.toggle('is-hidden', hidden);
        el.querySelector('.system-main')!.setAttribute('aria-pressed', String(store.selected === id));
        setText(el.querySelector('.status-glyph')!, STATUS_GLYPH[s.status]);
        setText(el.querySelector('.system-summary')!, summary(s));
        setText(el.querySelector('.system-status')!, STATUS_LABEL[s.status]);
        const toggle = el.querySelector('.layer-toggle')!;
        toggle.setAttribute('aria-pressed', String(!hidden));
        toggle.setAttribute('title', hidden ? `Show ${s.def.name} in 3D` : `Hide ${s.def.name} in 3D`);
        toggle.setAttribute('aria-label', hidden ? `Show ${s.def.name} layer` : `Hide ${s.def.name} layer`);
        setText(toggle.firstElementChild!, hidden ? 'Off' : 'On');
      },
    );
  }
}
