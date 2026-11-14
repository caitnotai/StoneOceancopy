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
- **Indicators with reasons.** Thirteen indicators (heart rate, blood pressure, SpO2, sleep, mood,
  exercise, glucose, radiation dose...). Each one explains why it matters in space, how to
  measure it, where its reference range comes from, and which NASA Human Research Program (HRP)
  risk it tracks.
- **"What should I do?"** A triage verdict answers the challenge question of when a result needs
  the crew or the flight surgeons. The same finding gives a different instruction depending on
  distance from Earth: on the station, *contact the flight surgeon now*; on Mars, where a reply
  takes 40 minutes, *start the onboard protocol now*.
- **Trends, not only values.** 7-day charts with status bands, and an early warning when a value
  is still nominal but heading out of range.
- **Self-check prompts.** Indicators the astronaut measures by hand become "due" on a schedule.
- **Four environments**: space station, lunar base, Mars transit, Mars surface. They change the
  radiation dose rate, gravity and signal delay.
- **Demo simulator** with six scenarios (exercise device failure, sleep disruption, viral
  reactivation, SANS signs, solar particle event, under-eating) and a fast mission clock.

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

- **All readings are simulated.** No real sensor is connected yet.
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
