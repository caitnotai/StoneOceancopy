import type { AppActions } from './app/actions';
import { APP_TITLE, HISTORY_DAYS, MISSION_START_MINUTES } from './config';
import { HealthStore } from './data/HealthStore';
import { MissionClock } from './data/MissionClock';
import { scenarioById } from './data/sources/scenarios';
import { SimulatedSource } from './data/sources/SimulatedSource';
import { loadSpaceWeather, snapshotSpaceWeather } from './data/spaceWeather';
import { STATUS_GLYPH, STATUS_LABEL } from './domain/status';
import type { HealthStatus } from './domain/types';
import { BodyViewport } from './scene/BodyViewport';
import { h } from './ui/dom';
import { SidePanel } from './ui/SidePanel';
import { SimulatorBar, type SimulatorState } from './ui/SimulatorBar';
import './ui/styles.css';
import { SystemList } from './ui/SystemList';
import { TopBar } from './ui/TopBar';

/**
 * Composition root: the only file that knows every layer.
 *
 *   sources (simulator, manual log)  ->  HealthStore  ->  rules engine (domain/)
 *                                             |
 *                         'data' / 'selection' / 'hover' events
 *                                             v
 *                         3D body (scene/)  and  panels (ui/)
 */
function bootstrap(): void {
  document.title = APP_TITLE;
  const $ = (id: string): HTMLElement => document.getElementById(id)!;

  const store = new HealthStore('iss');
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
  };

  new TopBar($('topbar'), store);
  new SystemList($('systems'), store);
  new SidePanel($('panel'), store, actions);
  new SimulatorBar($('simulator'), actions, simulatorState);

  const statuses: HealthStatus[] = ['nominal', 'caution', 'critical', 'unknown'];
  $('legend').append(
    ...statuses.map((status) =>
      h('span', { class: 'legend-item', dataset: { status } }, h('span', { class: 'status-glyph', 'aria-hidden': 'true' }, STATUS_GLYPH[status]), STATUS_LABEL[status]),
    ),
  );

  try {
    new BodyViewport($('stage'), store, { modelUrl: `${import.meta.env.BASE_URL}models/body.glb` });
  } catch (error) {
    console.error(error);
    $('stage').append(
      h('p', { class: 'viewport-fallback' }, '3D view unavailable: this browser could not start WebGL. The system list and panels still work.'),
    );
  }

  clock.start();
}

bootstrap();
