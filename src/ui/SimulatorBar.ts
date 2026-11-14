import type { AppActions } from '../app/actions';
import { CLOCK_SPEEDS } from '../data/MissionClock';
import { SCENARIOS, scenarioById } from '../data/sources/scenarios';
import { h, setText } from './dom';

export interface SimulatorState {
  scenarioId: string;
  speed: number;
  autoLog: boolean;
}

/** Demo controls, kept visually separate from the astronaut-facing console. */
export class SimulatorBar {
  private readonly description = h('p', { class: 'sim-description' });
  private readonly select: HTMLSelectElement;
  private readonly speedButtons: HTMLButtonElement[];
  private readonly autoLog: HTMLInputElement;

  constructor(parent: HTMLElement, actions: AppActions, private state: SimulatorState) {
    this.select = h(
      'select',
      {
        id: 'scenario',
        onchange: () => {
          this.state.scenarioId = this.select.value;
          actions.setScenario(this.select.value);
          this.render();
        },
      },
      ...SCENARIOS.map((s) => h('option', { value: s.id }, s.name)),
    );
    this.speedButtons = CLOCK_SPEEDS.map((speed) =>
      h(
        'button',
        {
          class: 'segment',
          type: 'button',
          onclick: () => {
            this.state.speed = speed.minutesPerSecond;
            actions.setSpeed(speed.minutesPerSecond);
            this.render();
          },
        },
        speed.label,
      ),
    );
    this.autoLog = h('input', {
      type: 'checkbox',
      id: 'auto-log',
      onchange: () => {
        this.state.autoLog = this.autoLog.checked;
        actions.setAutoLog(this.autoLog.checked);
      },
    });

    parent.append(
      h(
        'div',
        { class: 'sim-row' },
        h('span', { class: 'eyebrow' }, 'Demo simulator'),
        h('label', { for: 'scenario', class: 'sr-only' }, 'Scenario'),
        this.select,
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Simulation speed' }, ...this.speedButtons),
        h('label', { class: 'check', for: 'auto-log', title: 'When off, self-checks stop arriving and the crew member is prompted to log them.' }, this.autoLog, 'Auto-log self-checks'),
        h(
          'button',
          {
            class: 'button button-quiet',
            type: 'button',
            onclick: () => {
              this.state.scenarioId = SCENARIOS[0].id;
              actions.resetMission();
              this.render();
            },
          },
          'Restart',
        ),
      ),
      this.description,
    );
    this.render();
  }

  private render(): void {
    this.select.value = this.state.scenarioId;
    this.autoLog.checked = this.state.autoLog;
    this.speedButtons.forEach((button, i) =>
      button.setAttribute('aria-pressed', String(CLOCK_SPEEDS[i].minutesPerSecond === this.state.speed)),
    );
    setText(this.description, scenarioById(this.state.scenarioId).description);
  }
}
