import type { SpaceWeather } from '../data/spaceWeather';
import { h } from './dom';

const utc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const EVENTS_SHOWN = 3;

/**
 * Real solar radiation conditions: GOES proton flux from NOAA SWPC on the NOAA S-scale,
 * and the solar particle events on record in NASA DONKI. It says plainly whether the data
 * is live or the offline snapshot, and that the mission simulator is a separate thing.
 */
export class SpaceWeatherCard {
  readonly element = h('section', { class: 'space-weather' });

  constructor(weather: SpaceWeather) {
    this.render(weather);
  }

  render(weather: SpaceWeather): void {
    const { now } = weather;
    const status = now.level === 0 ? 'nominal' : now.level <= 2 ? 'caution' : 'critical';
    const satellite = weather.satellite ? `GOES-${weather.satellite}` : 'GOES';
    this.element.replaceChildren(
      h(
        'div',
        { class: 'space-weather-head' },
        h('h3', null, 'Space weather now'),
        h('span', { class: 'chip' }, weather.origin === 'live' ? 'Live feed' : 'Offline snapshot'),
      ),
      now.latest
        ? h(
            'p',
            { class: 'space-weather-level', dataset: { status } },
            h('span', { class: 'status-glyph', 'aria-hidden': 'true' }, status === 'nominal' ? '●' : status === 'caution' ? '▲' : '◆'),
            h('strong', null, `Solar radiation storm: S${now.level} (${now.levelName})`),
          )
        : h('p', { class: 'empty' }, 'No proton flux readings available.'),
      ...(now.latest
        ? [h(
            'dl',
            null,
            h('dt', null, 'Proton flux, 10 MeV or more'),
            h('dd', null, `${now.latest.value.toFixed(2)} pfu`),
            h('dt', null, 'Measured'),
            h('dd', null, `${utc(now.latest.t)} · ${satellite}`),
            h('dt', null, 'Level S1 starts at'),
            h('dd', null, `${now.s1Threshold} pfu`),
            h('dt', null, 'Event in progress'),
            h('dd', null, now.event.inProgress ? `Yes, peak ${now.event.peakPfu.toFixed(0)} pfu` : 'No'),
          )]
        : []),
      h(
        'p',
        { class: 'reference' },
        `Solar particle events on record from ${weather.eventsFrom ?? '?'} to ${weather.eventsTo ?? '?'}: ${weather.events.length} (NASA DONKI snapshot).`,
      ),
      h(
        'ul',
        { class: 'links' },
        ...weather.events.slice(0, EVENTS_SHOWN).map((event) =>
          h('li', null, h('a', { href: event.link, target: '_blank', rel: 'noopener' }, event.time.replace('T', ' ').replace('Z', ' UTC'))),
        ),
      ),
      h(
        'p',
        { class: 'reference' },
        'Real data from NOAA SWPC and NASA DONKI. The NOAA S-scale is an operational scale, not a NASA limit. The solar event in the demo simulator is synthetic.',
      ),
    );
  }
}
