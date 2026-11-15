import type { AppActions } from './app/actions';
import { APP_TITLE, HISTORY_DAYS, MISSION_START_MINUTES } from './config';
import { HealthStore } from './data/HealthStore';
import { MissionClock } from './data/MissionClock';
import { scenarioById } from './data/sources/scenarios';
import { SimulatedSource } from './data/sources/SimulatedSource';
import { loadSpaceWeather, snapshotSpaceWeather } from './data/spaceWeather';
import { STATUS_GLYPH, STATUS_LABEL } from './domain/status';
import type { IntroOptions } from './intro/IntroExperience';
import { environmentFor, loadProfile, type CrewProfile } from './intro/profile';
import type { HealthStatus } from './domain/types';
import { BodyViewport } from './scene/BodyViewport';
import { h } from './ui/dom';
import { SidePanel } from './ui/SidePanel';
import { SimulatorBar, type SimulatorState } from './ui/SimulatorBar';
import { SymptomReporter } from './ui/SymptomReporter';
import './ui/styles.css';
import { SystemList } from './ui/SystemList';
import { TopBar } from './ui/TopBar';
import { TwinViewControl } from './ui/TwinViewControl';

/**
 * Composition root: the only file that knows every layer.
 *
 *   sources (simulator, manual log)  ->  HealthStore  ->  rules engine (domain/)
 *                                             |
 *                         'data' / 'selection' / 'hover' events
 *                                             v
 *                         3D body (scene/)  and  panels (ui/)
 */
function bootstrap(profile: CrewProfile): void {
  const store = new HealthStore(environmentFor(profile));
  const clock = new MissionClock(MISSION_START_MINUTES);
  const simulator = new SimulatedSource(clock, () => store.environment);
  simulator.connect(store);

  // Real space weather: the bundled snapshot first (works offline), then the live feed.
  const offline = snapshotSpaceWeather();
  store.setSpaceWeather(offline);
  simulator.setQuietFlux(offline.now.latest?.value ?? null);
  void loadSpaceWeather().then((weather) => {
    if (weather.origin !== 'live') return;
    store.setSpaceWeather(weather);
    simulator.setQuietFlux(weather.now.latest?.value ?? null);
  });

  simulator.seedHistory(HISTORY_DAYS);

  const simulatorState: SimulatorState = { scenarioId: 'nominal', speed: clock.speed, autoLog: true };

  const actions: AppActions = {
    logReading(id, value) {
      const reading = { indicatorId: id, value, t: clock.now, source: 'manual' as const };
      simulator.absorb(reading);
      store.ingest([reading], clock.now);
    },
    setScenario: (id) => simulator.setScenario(scenarioById(id)),
    setSpeed: (minutesPerSecond) => clock.setSpeed(minutesPerSecond),
    setAutoLog: (enabled) => (simulator.autoLogSelfChecks = enabled),
    resetMission() {
      clock.now = MISSION_START_MINUTES;
      store.reset(clock.now);
      simulator.seedHistory(HISTORY_DAYS);
    },
    startIntervention(id, stepText, authorityLevel) {
      store.startIntervention(id, stepText, authorityLevel);
      // In the demo the countermeasure works: the simulated physiology starts to recover.
      simulator.applyCountermeasure(id);
    },
    setDrugsPreauthorized: (enabled) => store.setDrugsPreauthorized(enabled),
    reportSymptom: (input) => void store.reportSymptom(input),
    removeSymptom: (id) => store.removeSymptom(id),
  };

  new TopBar($('topbar'), store);
  // The crew member's name doubles as the way back to the introduction.
  $('topbar').append(
    h(
      'button',
      {
        class: 'crew-chip',
        type: 'button',
        title: 'Replay the introduction',
        'aria-label': `${profile.name}: replay the introduction`,
        onclick: () => playIntro({ profile, behind: $('app'), onEnter: () => {} }),
      },
      h('span', { class: 'crew-chip-initial', 'aria-hidden': 'true' }, profile.name.charAt(0).toUpperCase()),
      h('span', { class: 'crew-chip-name' }, profile.name),
    ),
  );
  new SystemList($('systems'), store);
  new SidePanel($('panel'), store, actions);
  new SimulatorBar($('simulator'), actions, simulatorState);
  new SymptomReporter($('viewport-tools'), $('symptom-form'), $('hint'), store, actions);
  new TwinViewControl($('viewport-tools'), $('hint'), store);

  const statuses: HealthStatus[] = ['nominal', 'caution', 'critical', 'unknown'];
  $('legend').append(
    ...statuses.map((status) =>
      h('span', { class: 'legend-item', dataset: { status } }, h('span', { class: 'status-glyph', 'aria-hidden': 'true' }, STATUS_GLYPH[status]), STATUS_LABEL[status]),
    ),
  );

  try {
    new BodyViewport($('stage'), store, {
      modelUrl: `${import.meta.env.BASE_URL}models/body.glb`,
      suitUrl: `${import.meta.env.BASE_URL}models/astronaut.glb`,
    });
  } catch (error) {
    console.error(error);
    $('stage').append(
      h('p', { class: 'viewport-fallback' }, '3D view unavailable: this browser could not start WebGL. The system list and panels still work.'),
    );
  }

  clock.start();
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/**
 * First visit: the introduction, then the app. Later visits go straight to the app
 * (add `?intro` to the address, or use the name in the top bar, to watch it again).
 */
function start(): void {
  document.title = APP_TITLE;
  const profile = loadProfile();
  const replay = new URLSearchParams(location.search).has('intro');
  if (profile && !replay) {
    bootstrap(profile);
    return;
  }
  if (profile) bootstrap(profile);
  playIntro({ profile, behind: $('app'), onEnter: profile ? () => {} : bootstrap });
}

/** The introduction (and GSAP) load on demand: returning crew members never download them. */
function playIntro(options: IntroOptions): void {
  import('./intro/IntroExperience')
    .then(({ runIntro }) => runIntro(options))
    .catch((error: unknown) => {
      // The introduction is optional; the health console is not.
      console.error(error);
      options.onEnter(options.profile ?? { name: 'Crew', habitat: null });
    });
}

start();
