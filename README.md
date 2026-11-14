# Crew Health Twin

A 3D health twin for astronauts. Instead of treating the body as a picture, the app treats it as
a **data structure**: every body system (skeletal, cardiovascular, muscular...) is an object with
live health indicators, and its status drives its color on an interactive 3D body.

Built for the NASA Space Apps Challenge 2026, challenge
*Create Health Monitoring Software for Astronauts on Space Missions*.

> Working title. Change `APP_TITLE` in `src/config.ts` to rename the app.

## What it does

- **Anatomical 3D body, one layer per system.** Real bones, muscles, vessels and organs from
  the BodyParts3D atlas, grouped into nine systems, each colored by its current status:
  nominal, caution or critical. Click a system on the body or in the list; click the same spot
  again to go one layer deeper. Layers can be hidden.
- **Detect, Treat, Verify.** Every indicator card follows the same loop. *Detect* shows the
  value, the status and where the threshold comes from. *Treat* lists the protocol steps with
  their authority level, from a reversible environmental action (level 1) to an emergency
  protocol (level 4). *Verify* closes an action only when the indicator is measured back in
  range; an action that was merely carried out stays pending.
- **Provenance on every alert.** Only two thresholds are NASA limits: cabin CO₂ (NASA-STD-3001
  Vol. 2 [V2 6004], 3 mmHg) and retinal thickness (NASA SANS clinical criteria, 20 and 55 µm).
  Every other range is labeled as not a NASA limit. Each rule lists its evidence with the class
  of provenance (observed in flight, ground analog, simulated, standard...), sample size,
  effect, confidence interval and a source that opens.
- **Real space weather.** The app reads the GOES proton flux from NOAA SWPC, places it on the
  NOAA S-scale and lists the solar particle events on record in NASA DONKI. It uses the live
  feed when there is a connection and a bundled snapshot when there is not.
- **Decision support, not prescription.** Medication steps are withheld unless the mission
  medical plan pre-authorizes drugs. That switch is off by default.
- **Sixteen indicators** (heart rate, blood pressure, SpO2, cabin CO₂, sleep, mood, exercise,
  retinal thickness, glucose, radiation dose, solar proton flux...). Each one explains why it
  matters in space and how to measure it.
- **"What should I do?"** A triage verdict answers the challenge question of when a result needs
  the crew or the flight surgeons. The same finding gives a different instruction depending on
  distance from Earth: on the station, *contact the flight surgeon now*; on Mars, where a reply
  takes 40 minutes, *start the onboard protocol now*.
- **Trends, not only values.** 7-day charts with status bands, and an early warning when a value
  is still nominal but heading out of range.
- **Self-check prompts.** Indicators the astronaut measures by hand become "due" on a schedule.
- **Four environments**: space station, lunar base, Mars transit, Mars surface. They change the
  radiation dose rate, gravity and signal delay.
- **Demo simulator** with seven scenarios (exercise device failure, sleep disruption, viral
  reactivation, SANS signs, solar particle event, CO₂ removal fault, under-eating) and a fast
  mission clock. Marking a protocol step as done makes the simulated indicator recover, so the
  Verify step can be seen working.

## Rules, evidence and sources

The rules come from a research report on NASA and partner-agency sources, transcribed into
data that the app, the tests and a SQLite database all read:

| File | Content |
|---|---|
| `data/matrix/rules.json` | 11 Detect-Treat-Verify rules (10 from the report, 1 added by the project and flagged) |
| `data/matrix/evidence.json` | 35 evidence claims with provenance class, n, effect, 95% CI and p |
| `data/matrix/sources.json` | 29 sources: 28 re-located in NASA NTRS, Crossref or by URL, 1 not located and flagged |
| `reference_map.csv` | every claim linked to a source that resolves, with its verification status |
| `data/snapshots/` | saved responses of the external sources, for offline use |
| `INVENTARIO.md` | audit of the project against the report, in Spanish (working document) |

Status in `reference_map.csv`: `verificado` means the key figure was found in the abstract of
the source; `fuente_localizada` means the source was found but the figure was not confirmed
(it may be in the full text). Most claims are in the second group.

```bash
npm run sources:smoke   # test every external source and save snapshots
npm run ingest:space-weather   # refresh the bundled GOES and DONKI snapshot
npm run refs:verify     # re-locate sources and rebuild reference_map.csv
npm run db:build        # build data/crew-health.db from data/matrix
```

Data provided by the NASA STI Program (NTRS), NOAA SWPC, NASA DONKI, NASA OSDR and PhysioNet.

## Run it

Requires Node 22 or newer.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # rules engine and simulator tests
npm run build    # static site in dist/
```

The build is a static site with relative paths: publish `dist/` on GitHub Pages, Vercel or
Netlify as is.

### Rebuilding the 3D model (optional)

`public/models/body.glb` (2.3 MB) is committed, so this step is only needed to change how the
atlas is reduced or grouped. Download `isa_BP3D_4.0_obj_99.zip`, `isa_element_parts.txt` and
`partof_element_parts.txt` from the
[BodyParts3D download page](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html)
into `assets-src/bodyparts3d/`, unzip the archive into `assets-src/bodyparts3d/obj/`, then:

```bash
npm run build:model
```

### 30-second demo script

1. Open the app: the body rotates, everything is green (*All systems nominal*).
2. Scenario **Viral reactivation**, speed **6 h/s**. The immune system turns amber, then red;
   the lungs go amber; the verdict escalates.
3. Click **Immune**: fever chart crossing the bands, and the list of actions.
4. Switch **Station -> Mars**: the verdict changes from "contact the flight surgeon" to "start
   the onboard protocol", because Earth can no longer answer in time.

## Architecture

Data flows one way. No layer reaches back into the one before it.

```
 sources                store                 rules engine              views
+----------------+    +--------------+    +---------------------+    +----------------------+
| SimulatedSource| -> | HealthStore  | -> | domain/engine       | -> | scene/  3D body      |
| manual log     |    | readings,    |    | classify, trend,    |    | ui/     panels,charts|
| (real sensors) |    | selection... |    | system status,triage|    +----------------------+
+----------------+    +--------------+    +---------------------+       | select / hover / log
        ^                    ^                                          |
        +--------------------+------------------------------------------+
                                actions only
```

| Folder | Responsibility | May import |
|---|---|---|
| `src/domain/` | The model and the rules. Systems, indicators and environments are **data** (`catalog/`); `engine/` turns readings into statuses, trends and a triage verdict. Pure TypeScript. | nothing |
| `src/data/` | `HealthStore` (single source of truth, typed events), `MissionClock`, and reading sources behind the `SensorSource` interface. | `domain` |
| `src/scene/` | three.js. `BodyModel` is the contract "one layer per system". `GltfBody` implements it with the anatomical model; `ProceduralBody` implements it from primitives and is the fallback if the model cannot load. `SystemVisuals` is the only place where status becomes color in 3D; `Picker` handles clicks. | `domain`, `data` |
| `src/ui/` | DOM panels and canvas charts. | `domain`, `data` |
| `src/main.ts` | Composition root: the only file that knows every layer. | all |
| `tools/` | Offline build of the 3D model: classifies the atlas parts by body system (`bodyparts/classify.mjs`), simplifies them and writes `public/models/body.glb`. | - |

Where to extend:

- **New indicator or body system**: add an entry in `src/domain/catalog/`. The list, the panels,
  the charts and the triage pick it up. A new system also needs a geometry builder in
  `src/scene/procedural/parts/`.
- **Real sensors** (BLE wearable, dosimeter, the phone's accelerometer): implement
  `SensorSource` and call `store.ingest()`. Nothing else changes.
- **Another body model** (a female body, a higher-detail atlas): implement `BodyModel`, or
  point `tools/build-body-model.mjs` at different meshes. The scene, picker and UI stay as
  they are.
- **Mission-specific reference ranges**: `EnvironmentDef.thresholdOverrides`.

### The 3D body

The body is built from [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html),
an atlas of about 2,200 anatomical parts of an adult male, each tagged with its concept in the
Foundational Model of Anatomy (FMA). That classification is what lets the build script sort
parts into body systems by rule instead of by hand: "is a bone organ" goes to the skeletal
system, "is part of the heart" goes to the cardiovascular system, and so on. The result is one
mesh per system part, 0.7 million triangles in a 2.3 MB file.

Three things are not in the atlas and are added by this project: lung outlines (the convex
hull of each lung's bronchi and vessels), lymph nodes and inner ears (drawn at run time at
positions taken from the model's own bones). See `public/models/README.md` for the full list
of changes.

## NASA and partner resources used

- NASA Human Research Program, *5 Hazards of Human Spaceflight*: https://www.nasa.gov/hrp/hazards/
- NASA Human Research Program, *Risks of Human Spaceflight*: https://www.nasa.gov/hrp/risks/
  (each body system links to the HRP risk it tracks)
- NASA-STD-3001, career radiation exposure limit of 600 mSv
- Canadian Space Agency, *Monitoring radiation for astronaut health*:
  https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp

3D anatomy:

- **BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0
  International.** https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html
  The meshes were simplified, regrouped and rescaled; details in `public/models/README.md`.

Other references for the simulator and reference ranges:

- Zeitlin et al. (2013), MSL/RAD cruise dose rate; Hassler et al. (2014), Mars surface dose rate
- Zhang et al. (2020), Chang'E-4 lunar surface dose rate
- Barger et al. (2014), sleep duration on the ISS
- General clinical ranges: American Heart Association / ACC (heart rate, blood pressure),
  American Diabetes Association (glucose), AASM/SRS (sleep)

## Limits

- **All crew readings are simulated.** No real sensor is connected yet. Space weather is the
  only real data, and the solar event in the demo simulator is synthetic.
- DONKI needs a personal api.nasa.gov key (`NASA_API_KEY`); without it the events listed are
  those of the bundled snapshot.
- **Reference ranges are illustrative.** A real mission would load ranges set by its flight
  surgeons. This is a concept for crew decision support, not a medical device.
- The body is one adult male. Meshes are simplified for the web, and the lung outlines, lymph
  nodes and inner ears are approximations added by this project.
- Frame rate on low-end graphics has not been measured.

## Use of AI tools

The source code of this prototype was written with the assistance of an AI coding tool
(Claude Code, Anthropic). The project idea (the body as a data structure whose systems change
color with live health data) is the team's own. No AI-generated images, video or audio are
included, and no NASA branding is used.

Tools: TypeScript, three.js, three-mesh-bvh, Vite, Vitest; glTF-Transform and meshoptimizer
for the model build.
