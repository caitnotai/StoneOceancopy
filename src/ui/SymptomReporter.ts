import type { AppActions } from '../app/actions';
import type { HealthStore } from '../data/HealthStore';
import { SYSTEMS } from '../domain/catalog/systems';
import { SYMPTOM_INTENSITY, SYMPTOM_NOTES_MAX, SYMPTOM_TYPE_LABEL, SYMPTOM_TYPES, type SymptomDraft, type SymptomType } from '../domain/symptoms';
import type { SystemId } from '../domain/types';
import { h, setText } from './dom';

const HINT_REPORTING = 'Click the body where you feel it · drag still rotates · Esc to cancel';

/**
 * "Report discomfort": a toggle beside the 3D view and the small form that follows a click
 * on the body. It only talks to the store: the 3D view marks the spot, this fills in the rest.
 */
export class SymptomReporter {
  private readonly toggle: HTMLButtonElement;
  private readonly form: HTMLFormElement;
  private readonly system = h('select', { id: 'symptom-system', name: 'system' });
  private readonly systemField: HTMLElement;
  private readonly intensity: HTMLInputElement;
  private readonly intensityValue = h('output', { class: 'symptom-intensity-value', for: 'symptom-intensity' });
  private readonly notes: HTMLTextAreaElement;
  private readonly error = h('p', { class: 'symptom-error', role: 'alert' });

  constructor(
    tools: HTMLElement,
    formHost: HTMLElement,
    private readonly hint: HTMLElement,
    private readonly store: HealthStore,
    private readonly actions: AppActions,
  ) {
    this.toggle = h(
      'button',
      { class: 'tool-toggle', type: 'button', 'aria-pressed': 'false', onclick: () => store.setReportMode(!store.reportMode) },
      h('span', { class: 'tool-toggle-icon', 'aria-hidden': 'true' }, '✚'),
      'Report discomfort',
    );
    tools.append(this.toggle);

    this.intensity = h('input', {
      id: 'symptom-intensity',
      name: 'intensity',
      type: 'range',
      min: String(SYMPTOM_INTENSITY.min),
      max: String(SYMPTOM_INTENSITY.max),
      step: '1',
      oninput: () => this.showIntensity(),
    });
    this.notes = h('textarea', { id: 'symptom-notes', name: 'notes', rows: 2, maxLength: SYMPTOM_NOTES_MAX, placeholder: 'When it started, what makes it better or worse…' });
    this.systemField = h('div', { class: 'symptom-field' }, h('label', { for: 'symptom-system' }, 'Body system'), this.system);

    this.form = h(
      'form',
      { class: 'symptom-form', hidden: true, 'aria-labelledby': 'symptom-form-title', onsubmit: (event: Event) => this.submit(event) },
      h(
        'header',
        { class: 'symptom-form-head' },
        h('h3', { id: 'symptom-form-title' }, 'Report discomfort'),
        h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Cancel report', onclick: () => store.setReportMode(false) }, '×'),
      ),
      this.systemField,
      h(
        'div',
        { class: 'symptom-field' },
        h('div', { class: 'symptom-label-row' }, h('label', { for: 'symptom-intensity' }, 'Intensity'), this.intensityValue),
        this.intensity,
        h('div', { class: 'symptom-scale', 'aria-hidden': 'true' }, h('span', null, '1 · barely noticeable'), h('span', null, '10 · worst imaginable')),
      ),
      h(
        'fieldset',
        { class: 'symptom-field symptom-types' },
        h('legend', null, 'Type'),
        ...SYMPTOM_TYPES.map((type) =>
          h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'type', value: type, onchange: () => (this.error.textContent = '') }), h('span', null, SYMPTOM_TYPE_LABEL[type])),
        ),
      ),
      h('div', { class: 'symptom-field' }, h('label', { for: 'symptom-notes' }, 'Notes (optional)'), this.notes),
      this.error,
      h('p', { class: 'reference' }, 'Saved to the mission log with a pin on the body. It does not change any status or alert.'),
      h(
        'div',
        { class: 'symptom-actions' },
        h('button', { class: 'button button-quiet', type: 'button', onclick: () => store.setReportMode(false) }, 'Cancel'),
        h('button', { class: 'button button-primary', type: 'submit' }, 'Save report'),
      ),
    );
    formHost.append(this.form);

    store.events.on('reportMode', (enabled) => this.applyMode(enabled));
    store.events.on('symptomDraft', (draft) => this.applyDraft(draft));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && store.reportMode) store.setReportMode(false);
    });
    this.applyMode(store.reportMode);
  }

  private applyMode(enabled: boolean): void {
    this.toggle.setAttribute('aria-pressed', String(enabled));
    // The view control writes the everyday hint; this one only speaks while reporting.
    if (enabled) setText(this.hint, HINT_REPORTING);
    this.hint.classList.toggle('is-active', enabled);
  }

  private applyDraft(draft: SymptomDraft | null): void {
    if (!draft) {
      this.form.hidden = true;
      return;
    }
    const firstSpot = this.form.hidden;
    if (firstSpot) {
      // A new report starts clean; moving the pin keeps what was already filled in.
      this.form.reset();
      this.intensity.value = String(SYMPTOM_INTENSITY.initial);
      this.error.textContent = '';
    }
    this.system.replaceChildren(...draft.systems.map((id) => h('option', { value: id }, SYSTEMS[id].name)));
    this.system.disabled = draft.systems.length < 2;
    this.showIntensity();
    this.form.hidden = false;
    if (firstSpot) this.intensity.focus({ preventScroll: true });
  }

  private showIntensity(): void {
    setText(this.intensityValue, `${this.intensity.value} / ${SYMPTOM_INTENSITY.max}`);
  }

  private submit(event: Event): void {
    event.preventDefault();
    const draft = this.store.symptomDraft;
    if (!draft) return;
    const type = new FormData(this.form).get('type');
    if (typeof type !== 'string') {
      this.error.textContent = 'Choose the type that fits best.';
      this.form.querySelector<HTMLInputElement>('input[name="type"]')?.focus();
      return;
    }
    this.actions.reportSymptom({
      systemId: this.system.value as SystemId,
      position: draft.position,
      intensity: Number(this.intensity.value),
      type: type as SymptomType,
      notes: this.notes.value,
    });
    this.toggle.focus({ preventScroll: true });
  }
}
