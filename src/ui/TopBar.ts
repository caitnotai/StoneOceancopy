import { APP_SUBTITLE, APP_TITLE } from '../config';
import type { HealthStore } from '../data/HealthStore';
import { formatMissionTime } from '../data/MissionClock';
import { ENVIRONMENT_LIST, formatDelay } from '../domain/catalog/environments';
import { h, setText } from './dom';

/** Title, mission clock and the environment switch. */
export class TopBar {
  constructor(parent: HTMLElement, store: HealthStore) {
    const clock = h('span', { class: 'mission-clock' });
    const facts = h('span', { class: 'env-facts' });
    const buttons = ENVIRONMENT_LIST.map((env) =>
      h(
        'button',
        {
          class: 'segment',
          type: 'button',
          title: `${env.name}. ${env.description}`,
          onclick: () => store.setEnvironment(env.id),
        },
        env.shortName,
      ),
    );

    parent.append(
      h(
        'div',
        { class: 'brand' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
        h('div', null, h('h1', null, APP_TITLE), h('p', null, APP_SUBTITLE)),
      ),
      h(
        'div',
        { class: 'mission' },
        clock,
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Mission environment' }, ...buttons),
        facts,
      ),
    );

    const renderEnvironment = (): void => {
      const env = store.environment;
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(ENVIRONMENT_LIST[i].id === env.id)));
      setText(
        facts,
        `${env.gravityG === 0 ? 'Microgravity' : `${env.gravityG} g`} · ${formatDelay(env.commsDelaySec)} to Earth · ${env.radiationMSvPerDay} mSv/day`,
      );
    };
    const renderClock = (): void => {
      const { day, clock: time } = formatMissionTime(store.missionTime);
      setText(clock, `Mission day ${day} · ${time}`);
    };

    store.events.on('environment', renderEnvironment);
    store.events.on('data', renderClock);
    renderEnvironment();
    renderClock();
  }
}
