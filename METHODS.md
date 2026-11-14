# Methods

How the prototype turns readings into alerts, what evidence each rule rests on, how the
statistics were validated and where they stop being trustworthy. Every number in the
validation section is reproduced by the command shown next to it; the scripts are seeded.

## 1. What this is, and what it is not

Decision support for a crew member who cannot wait for a flight surgeon. It is not a
diagnostic device and it never prescribes: medication steps are withheld unless the mission
medical plan pre-authorizes drugs, and that switch is off by default.

Two readings of "validated" must not be confused:

- **Validated here**: the software pipeline. Given numbers with known properties, does it
  detect what it should and stay quiet when it should?
- **Not validated here**: any claim about spaceflight physiology. The proxy datasets are
  healthy people on Earth. They test the pipeline; they prove nothing about space.

## 2. Data sources

| Source | Used for | Access | Snapshot in the repo |
|---|---|---|---|
| NOAA SWPC, GOES integral proton flux | real space weather, NOAA S-scale | `services.swpc.noaa.gov/json/goes/primary/` (no key) | `data/snapshots/swpc/`, `space-weather.json` |
| NASA DONKI, SEP events | solar particle events on record | `api.nasa.gov/DONKI/SEP` (needs a key; `DEMO_KEY` is rate-limited) | `data/snapshots/donki/` |
| NASA NTRS, Crossref | re-locating every cited source | `ntrs.nasa.gov/api/citations/search`, `api.crossref.org` | `data/matrix/sources.resolved.json` |
| MMASH v1.0.0 (PhysioNet) | validating baseline and drift detection | `physionet.org/files/mmash/1.0.0/MMASH.zip`, 24.6 MB | `data/snapshots/mmash/derived.json` (60 KB, ODbL) |
| NASA OSDR, studies OSD-569, 570, 571, 575 | not used yet (see section 9) | `osdr.nasa.gov/osdr/data/osd/` | file lists only, `data/snapshots/osdr/` |

Data provided by the NASA STI Program (NTRS), NOAA SWPC, NASA DONKI, NASA OSDR and PhysioNet.
MMASH: Rossi A. et al., *Multilevel Monitoring of Activity and Sleep in Healthy People*,
PhysioNet, https://doi.org/10.13026/cerq-fc86, Open Database License v1.0.

## 3. Rules and provenance

The rules are the Detect-Treat-Verify matrix of a research report on NASA and partner-agency
sources, transcribed to `data/matrix/`. Each of the 35 evidence claims carries one of seven
provenance classes, which are never pooled:

`observado_en_vuelo` (observed in flight), `analogo_terrestre` (ground analog),
`IMM_simulado` (Integrated Medical Model simulation), `modelo_radiacion` (radiation model),
`estandar_obligatorio` (mandatory standard), `criterio_clinico_NASA` (NASA clinical
criterion), `hipotesis_gap_HRR` (open research gap).

**Re-linking sources.** The report's citations did not resolve. `tools/references/verify.mjs`
looks each source up again in NTRS, in Crossref (a DOI is accepted only if the title matches)
or by URL, then searches the abstract found for the key figure of the claim.

| Status | Meaning | Claims |
|---|---|---|
| `verificado` | source located and the figure found in its abstract | 6 |
| `fuente_localizada` | source located; figure not confirmed (it may be in the full text) | 28 |
| `sin_verificar` | no source located | 1 |

Reproduce: `npm run refs:verify`. The one unverified claim (typical dose rate on the station)
is a simulator parameter and a test prevents it from backing any alert.

## 4. Detect

The basis of every threshold is recorded in `src/domain/evidence/indicatorRules.ts` and shown
on the dashboard next to each alert.

| Basis | Indicators | Rule |
|---|---|---|
| NASA standard | cabin CO2 | one-hour average of 3 mmHg or less (NASA-STD-3001 Vol. 2 [V2 6004]). Above it is caution. Nothing is critical: off-nominal limits belong to the program |
| NASA clinical criterion | retinal thickness change | 20 um or more is caution (early indication); 55 um or more is critical (clinically concerning) |
| NOAA operational scale | solar proton flux | S1 from 10 pfu, S3 from 1,000 pfu. S1-S2 caution, S3 and above critical. Not a NASA limit; the mapping of levels to caution and critical is this project's choice |
| Program budget | cumulative dose | none set by default, so the dose is tracked and never judged. With a budget: acceptable up to it, critical beyond, no intermediate band |
| Individual baseline | 11 indicators: heart rate, blood pressure, both exercise measures, SpO2, sleep, mood, dizziness, temperature, glucose, calorie intake | deviation from the person's own first 14 days (below). Labeled "not a NASA limit" |
| Illustrative terrestrial range | the vision score, and the 11 above until 14 days are recorded | general clinical ranges, labeled "not a NASA limit" |

**How the 11 indicators are judged** (`src/domain/engine/monitor.ts`). NASA publishes no
limit for them, so the person is compared with themselves:

1. Readings are reduced to one value per crew day (08:00 to 08:00): the mean of the day for
   a sensor, the day's measurement for something measured once a day.
2. The first 14 complete days are the baseline, fitted once (section 5) and then frozen, so
   a slow change cannot drag the baseline along with it. It uses the person's own data only
   (no population prior): there is no reference population of daily values to shrink toward.
3. Every later day is standardized against the baseline and fed to EWMA and CUSUM
   (section 6), which catch a change that is small but sustained.
4. The value now is compared with the baseline directly (single-value rule, section 6),
   which catches a sudden large change. For a daily measure it is the latest measurement.
   For a sensor it is the mean of the last 24 hours, never the part of the day lived so far:
   heart rate and temperature follow a day-night rhythm, and a morning alone runs about
   1.5 baseline SDs above the daily mean in the simulator.
5. The status is caution or critical when any of the three rules is beyond its limit now.

Only the adverse direction counts: sleeping or exercising more than usual is not an alert;
heart rate, blood pressure and glucose are watched in both directions. After a treatment is
recorded the detectors restart, so the status reflects the response and not the excursion
that prompted the action; until a first value exists after the treatment, the earlier status
stands. Until a person has 14 complete days, the illustrative range is used and labeled as
such. The vision score stays on its illustrative range: it is taken every three days, too
rarely to build a 14-value baseline within a demo.

The dashboard shows, on every such indicator: the basis ("Individual baseline · not a NASA
limit"), the baseline mean and SD, the value now in SDs from it, the three rules with their
limits, and which rule raised the flag. The API returns the same under `baseline`.

## 5. Individual baseline

Where NASA publishes no limit, the right comparison is the person against themselves.

Model (normal-normal, empirical Bayes), for reading *j* of person *i*:

```
y_ij ~ Normal(theta_i, sigma^2)      theta_i ~ Normal(mu, tau^2)
```

**Population** (`fitPopulation`), by the method of moments over *k* subjects with means
`m_i`, variances `s_i^2` and `n_i` readings:

```
mu      = mean of m_i
sigma^2 = sum((n_i - 1) s_i^2) / sum(n_i - 1)
tau^2   = max(0, var(m_i) - sigma^2 * mean(1 / n_i))
```

**Person** (`fitBaseline`), from their own `n` readings with mean `m` and variance `s^2`:

```
sigma^2   = ((n - 1) s^2 + 4 sigma_pop^2) / (n - 1 + 4)     own variance, stabilized by 4 pseudo-observations
B         = (sigma^2 / n) / (sigma^2 / n + tau^2)           shrinkage: 1 = population only, 0 = own data only
mean      = B mu + (1 - B) m
V         = (1 - B) sigma^2 / n                             posterior variance of the level
sd        = sqrt(sigma^2 + V)                               predictive SD of one new reading
```

A reading is standardized as `z = (y - mean) / sd`; the predictive interval at level *p* is
`mean +/- q sd` with `q` the normal quantile. Without a population, `B = 0` and the baseline
is the person's own mean with `sd = sqrt(s^2 (1 + 1/n))`.

Assumptions: normal, independent readings; constant within-person variance; quantiles from
the normal distribution rather than Student's t, which is slightly optimistic for small *n*.

## 6. Drift detection

Applied to the standardized readings `z_t`.

```
EWMA   s_t  = lambda z_t + (1 - lambda) s_(t-1),  s_0 = 0
       signal when |s_t| > L sqrt(lambda / (2 - lambda) (1 - (1 - lambda)^(2t)))

CUSUM  C+_t = max(0, C+_(t-1) + z_t - k)          C-_t = max(0, C-_(t-1) - z_t - k)
       signal when C+_t > h or C-_t > h
```

`lambda = 0.2` and `k = 0.5` are fixed; `L` and `h` are calibrated, never chosen by hand.

**Textbook calibration** assumes the baseline is known exactly and targets the in-control
average run length (ARL0), for independent standard-normal readings, 6,000 runs:

| Target ARL0 | EWMA L | CUSUM h | ARL0 using either detector |
|---|---|---|---|
| 100 | 2.377 | 3.516 | 77.8 |
| 1,000 | 3.185 | 5.742 | 718 |

**Operational calibration.** In use the baseline is estimated from a short period, and that
error behaves like a small permanent shift. With the textbook limits for ARL0 = 100 and a
baseline estimated from 14 readings, the probability of at least one false alarm in 30 days
is **0.50**, not the 0.26 that ARL0 = 100 implies. So the limits meant for the app are
calibrated under the real conditions: baseline estimated from 14 readings, then 30 monitored
readings, for a target probability of a false alarm in that window (30,000 runs; each
drift detector gets half of the budget).

**Single-value rule.** EWMA and CUSUM are slow to react to one extreme value: once the EWMA
limit has settled, a single reading must be about 7.7 SD out to cross the caution limit. The
standard remedy is a limit on the value itself (a Shewhart rule): signal when `|z_t| > S`.
`S` is calibrated the same way, for a fifth of the level's target (300,000 runs, because
the events are rarer). Most of the false alarms it would raise are ones the EWMA raises
anyway, so the three rules together stay under the target.

| Level | Target false alarm in 30 readings | EWMA L | CUSUM h | Single value S | Observed, EWMA or CUSUM | Observed, any of the three |
|---|---|---|---|---|---|---|
| caution | 0.05 | 4.596 | 12.15 | 4.726 | 0.034 | 0.038 |
| critical | 0.005 | 6.179 | 21.824 | 6.131 | 0.0037 | 0.0042 |

These are the limits the app uses: `monitor.ts` reads them from the calibration file, and a
test checks that it does. They are two-sided; indicators watched in one direction only have
about half these rates.

Reproduce the tables: `npm run validate:calibrate` (about two minutes; output in
`data/validation/drift-calibration.json`).

## 7. Radiation, CO2 and verification

**Solar particle events.** The latest >=10 MeV flux gives the NOAA S level. An event "in
progress" needs three consecutive readings at S1 or above, so that one glitch is not an
event (`detectSpe`). The app shows the live GOES feed when online and a bundled snapshot
otherwise. No dose is computed from the flux: there is no validated conversion for this
purpose.

**Environment dose rates** (1.84 mSv/day in transit and about 0.7 mSv/day on the Martian
surface from MSL/RAD; 1.37 mSv/day on the lunar surface) are observed environments used as
simulator parameters. They are not thresholds.

**CO2 headache risk** (`src/domain/stats/co2.ts`). A logistic curve for the probability of a
headache report against the 7-day average ppCO2, taken as a prior from published station
data and not fitted here:

```
logit(p) = logit(0.01) + ln(2) (x - 2.5)
```

That is, about 1% at 2.5 mmHg and odds doubling per mmHg, which gives 1.41% at 3 mmHg, as
reported. The uncertainty of the odds ratio is **not reported** in our source: the interval
the code can draw uses an assumed standard deviation of 0.25 on the log odds ratio, and must
be read as an assumption. The model is not yet shown in the dashboard.

**Verify** (`src/domain/engine/verify.ts`). An intervention is closed by measurement only.
Against a fixed limit: verified when the indicator is read back in range (three consecutive
readings for sensors sampled every two hours or less, one for daily measures), not verified
when three measurement cycles (at least six hours) pass without that. Against the individual
baseline: verified when the value now (section 4, so a sensor needs a full 24 hours after
the treatment) is back within the person's usual range, `mean +/- 1.96 sd` on the adverse
side, and not verified when three days pass without that. Both windows are project
parameters, not NASA figures.

## 8. Validation

### 8.1 Anomaly injection: sensitivity and false alarms

Simulated people with a baseline estimated from 14 readings; a step shift, in within-person
standard deviations, injected at the start of 30 monitored readings; 5,000 runs per row;
any of the three rules. Shift 0 is the false-alarm rate.

Caution limits (L = 4.596, h = 12.15, S = 4.726):

| Shift (SD) | Within 1 | Within 3 | Within 7 | Within 30 | Median delay |
|---|---|---|---|---|---|
| 0 | 0.000 | 0.002 | 0.006 | 0.041 | - |
| 0.5 | 0.001 | 0.004 | 0.017 | 0.189 | 19 |
| 1 | 0.004 | 0.024 | 0.096 | 0.636 | 16 |
| 1.5 | 0.009 | 0.082 | 0.316 | 0.951 | 11 |
| 2 | 0.026 | 0.209 | 0.625 | 0.998 | 6 |
| 3 | 0.111 | 0.632 | 0.968 | 1.000 | 3 |
| 4 | 0.316 | 0.933 | 1.000 | 1.000 | 2 |
| 6 | 0.828 | 1.000 | 1.000 | 1.000 | 1 |
| 8 | 0.990 | 1.000 | 1.000 | 1.000 | 1 |

Critical limits (L = 6.179, h = 21.824, S = 6.131): false alarm in 30 readings 0.002; a 3 SD
shift is detected within 7 readings with probability 0.758, a 4 SD shift with 0.978.

What this says plainly: the price of few false alarms is slow detection of small drifts. A
drift of one standard deviation is caught within a week only 10% of the time and within a
month 64% of the time. Shifts of three standard deviations or more are caught within a week
almost always.

**What the single-value rule adds.** A shift that starts on the first monitored day is
caught early by the EWMA anyway, because its limit starts narrow. The rule matters for a
jump that arrives later. A step on reading 20, after 19 quiet readings, at the caution
limits (flagged on that same reading / within three readings):

| Jump (SD) | EWMA and CUSUM alone | With the single-value rule |
|---|---|---|
| 3 | 0.039 / 0.439 | 0.116 / 0.466 |
| 4 | 0.083 / 0.779 | 0.297 / 0.794 |
| 5 | 0.150 / 0.956 | 0.569 / 0.960 |
| 6 | 0.258 / 0.996 | 0.807 / 0.996 |
| 8 | 0.529 / 1.000 | 0.986 / 1.000 |

Reproduce: `npm run validate:injection` (output in `data/validation/anomaly-injection.json`).

### 8.2 Sensitivity analysis

Length of the baseline period, at the caution limits:

| Baseline readings | False alarm in 30 | Detection of 2 SD within 7 |
|---|---|---|
| 5 | 0.199 | 0.582 |
| 7 | 0.122 | 0.607 |
| 10 | 0.073 | 0.607 |
| 14 | 0.041 | 0.625 |
| 28 | 0.010 | 0.650 |

The limits are calibrated for 14 readings: with a shorter baseline, false alarms rise fast
(five times more with 5 readings). EWMA weight, EWMA alone at the caution limit: lambda 0.1,
0.2, 0.3 and 0.5 give false alarms of 0.030, 0.026, 0.019 and 0.016 and detection of a 2 SD
shift within 7 readings of 0.668, 0.625, 0.556 and 0.399. Same command as 8.1.

### 8.3 Real human data: MMASH

22 healthy young men, about 24 hours each, on Earth.

**A. Empirical-Bayes baseline** on hourly mean heart rate (22 subjects, 525 subject-hours).
Population: mean 75.4 bpm, between-subject SD 5.7, within-subject SD 13.8. A person's level
is predicted from *k* randomly chosen hours and compared with the mean of their remaining
hours; the population is always fitted without that person; 300 repeats per subject.

| Own readings | RMSE, raw mean | RMSE, shrunk | Error reduction | Mean shrinkage |
|---|---|---|---|---|
| 1 | 14.22 | 6.25 | 56.0% | 0.854 |
| 2 | 10.24 | 5.99 | 41.5% | 0.733 |
| 3 | 8.41 | 5.85 | 30.5% | 0.639 |
| 5 | 6.82 | 5.62 | 17.6% | 0.510 |
| 8 | 5.97 | 5.36 | 10.1% | 0.392 |

Calibration of the predictive intervals built from 5 readings, on the held-out hours:

| Nominal coverage | 0.50 | 0.80 | 0.90 | 0.95 | 0.99 |
|---|---|---|---|---|---|
| Observed | 0.508 | 0.823 | 0.923 | 0.958 | 0.984 |

Shrinkage helps most when readings are few, as theory says, and the intervals are close to
nominal, slightly wide in the middle and slightly narrow at 99%.

**B. False alarms on a real signal.** In-bed heart rate in 5-minute means, 19 subjects, 633
monitored blocks, no change injected, textbook limits for ARL0 = 100 (nominal rate 0.01 per
reading). Observed: EWMA 0.0253 (2.5 times nominal), CUSUM 0.0205 (2.1 times). The median
lag-1 autocorrelation of the monitored series is 0.51. Real physiological signals are not
independent, and the detectors assume they are: on closely spaced readings the false-alarm
rate is about double. Monitoring daily aggregates reduces this but does not remove it.

**C. Backtest on sleep disturbance.** 19 subjects with a recorded night. A one-sided CUSUM on
the per-minute activity counts, standardized against the person's own quiet level that
night, counts disturbance episodes.

| Comparison | Spearman | 95% CI (bootstrap) |
|---|---|---|
| CUSUM episodes vs awakenings reported by the dataset | 0.40 | -0.03 to 0.73 |
| Minutes above the reference vs reported wake after sleep onset | 0.68 | 0.22 to 0.91 |

Agreement with reported wake time is moderate. Agreement on the *number* of awakenings is
weak and its interval includes zero; the detector also counts fewer episodes (median 13
against 19). The reference itself comes from the actigraph's software, not from
polysomnography, so this is agreement between two activity-based methods.

Three subjects are missing from B and C: one has no sleep record and two have no signal
during the reported night.

Reproduce: `npm run ingest:mmash` (after downloading and unzipping MMASH.zip into
`data/raw/mmash/extract/`; a derived copy is already in the repo) and `npm run validate:mmash`
(output in `data/validation/mmash-validation.json`).

## 9. Limitations

- **The baseline in the app comes from simulated days.** The 14 baseline days of the demo
  are generated by the simulator, whose day-to-day spreads are illustrative parameters and
  not measurements of any crew. The method is what is being shown, not the numbers.
- **A sudden change in a sensor is seen through the 24-hour mean**, so it takes hours, not
  minutes: in the fever scenario of the demo, 15 hours to caution. A rule on single readings
  would need a baseline by time of day, which is not built. Cabin CO2 and proton flux are
  not affected: they are judged reading by reading against their own limits.
- **In the simulated healthy missions** used as a regression test (10 missions of 30 days,
  110 indicator-missions) the alert counts are within what the calibration predicts, but
  that is the simulator agreeing with a model of independent normal days. Real daily values
  are autocorrelated, and section 8.3 B shows what that does to false alarms.
- **The baseline is frozen after 14 days.** A real, harmless adaptation to flight during
  those days or after them is not modeled; re-baselining is a clinical decision.
- **MMASH** is 22 healthy young men, one day each, on Earth. No within-person day-to-day
  variation can be estimated from it, and that is exactly what daily monitoring needs.
- **Inspiration4 (OSDR) was not analysed.** The planned pre/post comparison has 4 people and
  a 3-day flight; whatever it shows would have very wide intervals. Only the file lists were
  retrieved.
- **Independence.** All calibration assumes independent normal readings. Section 8.3 B shows
  about twice the nominal false alarms on closely spaced real data.
- **Small drifts are slow to detect** at limits that keep false alarms rare (section 8.1).
- **All crew readings in the app are simulated.** Only space weather is real, and the solar
  event of the demo is synthetic.
- **28 of 35 evidence claims** have a located source but an unconfirmed figure.
- **Assumed, not sourced**: the spread of the CO2 odds ratio, the verification window, the
  mapping of NOAA levels to caution and critical, and the 4 pseudo-observations that
  stabilize the variance.
- **The illustrative ranges**, used for the vision score and for any indicator until its
  baseline exists, are general clinical guidance for people on Earth.
- No calibration curve exists for the CO2 risk model: there is no outcome data to check it
  against.

## 10. Reproducing everything

| Command | What it does | Time |
|---|---|---|
| `npm test` | 141 unit tests, including the statistics library, the baseline monitoring and the API | seconds |
| `npm run demo:check` | proves the demo needs no connection (snapshots, build, engine and API with the network blocked) | under a minute |
| `npm run sources:smoke` | tests every external source and saves snapshots | under a minute |
| `npm run refs:verify` | re-locates sources and rebuilds `reference_map.csv` | about a minute |
| `npm run db:build` | builds the SQLite database from `data/matrix/` | seconds |
| `npm run ingest:space-weather` | refreshes the GOES and DONKI snapshot | seconds |
| `npm run ingest:mmash` | rebuilds the derived MMASH file from the raw download | seconds |
| `npm run validate:calibrate` | section 6 | about two minutes |
| `npm run validate:injection` | sections 8.1 and 8.2 | about a minute |
| `npm run validate:mmash` | section 8.3 | seconds |
| `npm run validate` | the three validation scripts in order | about three minutes |

The scripts need Node 24: they import the TypeScript statistics modules directly.
