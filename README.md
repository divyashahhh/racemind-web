# RaceMind

An F1 race-strategy simulator. Pick a circuit, compare pit-stop plans, and see the
outcome as a **distribution** rather than a single number — because the question a
strategist actually asks is not "how fast is this plan?" but "how often does it win?".

```
racemind/
├── web/        the application (Vite + React + TypeScript, no backend)
├── ml/         the offline modelling pipeline (Python)
└── RaceMind/   the original Expo prototype, superseded — see "History" below
```

## Quick start

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

That is all that is needed. The fitted model ships as static JSON in
`web/src/models/`, the Monte Carlo runs in a Web Worker in the browser, and the only
network calls are to OpenF1 for historical race data on the Race tab.

```bash
npm run test       # 32 tests: simulation invariants, fitted-model sanity, page smoke tests
npm run build      # production bundle (~67 KB gzipped)
```

## What it does

**Strategy** — the main screen. A shortlist of genuinely different plans (one-stop,
two-stop, three-stop), each rendered as a lap-proportional stint bar. Drag a pit stop
and everything re-simulates as you drag, so you can feel whether a call is robust or
knife-edge. Below it: the race trace with an uncertainty fan, the outcome
distributions, a pit-window heatmap, and the undercut window.

**Race** — any grand prix from 2023 onward, live from OpenF1: real compounds, real
stint lengths, real pit-stop counts, pace figures computed only from green-flag laps.

**Model** — the fitted degradation curves with their posterior bands, the coefficient
table, and the backtest scorecard.

**Explore** — every circuit compared on degradation, pit loss and safety-car rate.

## How the model works

### Lap time

```
t(lap) = base_pace
       + α_compound + β_compound·age + γ_compound·age²     tyre
       + φ·(race_laps − lap)                               fuel burn-off
       + ε                                                 AR(1) noise
```

Fuel makes the car **faster** as the race runs — it is heaviest on lap 1. Noise is
autocorrelated, not independent: consecutive laps share traffic, wind and driver
rhythm, and treating them as independent makes the outcome distribution far too tight.

### Fitting (`ml/`)

Fitted on **66,278 green-flag laps from 84 races across 2023–2026**, after dropping
in-laps, out-laps, safety-car laps and outliers (29% of all laps are excluded).

The driver-race intercept is removed with a within transformation, so a slow car on
hards is not mistaken for a degraded tyre. Circuits are partially pooled toward a
global fit with an empirical-Bayes weight `n/(n+k)`, letting thinly-observed circuits
borrow strength instead of producing nonsense.

Two orderings are imposed as non-negativity constraints rather than left to the data
— see "Honest limitations" for why this is necessary and not cosmetic.

### Simulation

A lap-discretised Monte Carlo, ~1,500 iterations by default, sampling degradation
coefficients from their posteriors, AR(1) lap noise, log-normal pit-stop durations,
per-circuit safety-car hazards, and optionally rain.

Every candidate plan is scored against the **same** sampled race (common random
numbers). That is what makes head-to-head win probabilities usable at only 1,500
iterations — comparing independently-sampled marginals would need orders of magnitude
more.

## Honest limitations

These are surfaced in the app's Model tab too, not buried here.

**The cliff is not identifiable from race data.** Fitted without constraints, the
quadratic term comes out *negative* for all three compounds — the model would claim
tyres stop degrading the longer you run them. The cause is survivorship: teams pit
*before* the cliff, so the laps observed at high tyre age are exactly the stints that
were going well. Constraining γ ≥ 0 collapses it to near zero. Identifying a real
cliff needs practice long-run data, where teams deliberately run a set to destruction.
**The shipped model is therefore close to linear in tyre age.**

**The compound ladder is imposed, not discovered.** Tyre age and lap number are
perfectly collinear *within* a stint, so degradation and fuel separate only through
across-stint variation. The unconstrained fit loads its misspecification onto whichever
compound runs the longest stints — the hard — which then appears to degrade faster than
the soft. Since a softer Pirelli compound is softer *precisely because* it wears faster,
SOFT ≥ MEDIUM ≥ HARD is encoded as a constraint. The same is done for fresh-tyre pace.

**No track position.** The simulator races a stopwatch, not other cars. There is no
traffic, no dirty air, no overtaking difficulty. The undercut is modelled analytically
and shown separately rather than being part of the race simulation. This is the single
largest gap, and it is why the optimiser systematically prefers cleaner plans than real
pit walls choose.

**Backtest results are mediocre, and reported as such.** 55% stop-count accuracy and
8.1 laps stint MAE against what teams actually did. Note that teams' own choices are
not optimal either, so 100% would itself be a red flag — but these numbers are not
good, and the Model tab shows them rather than hiding them.

**2023 onward only.** OpenF1 has no data before 2023. The app offers exactly the
seasons that exist.

## Rebuilding the model

```bash
cd ml
python3 -m venv .venv && .venv/bin/pip install numpy pandas scipy requests pyarrow

.venv/bin/python ingest.py     # ~20 min, throttled to OpenF1's 3 req/s + 30 req/min
.venv/bin/python clean.py      # filter to green-flag laps -> out/laps.parquet
.venv/bin/python fit.py        # constrained hierarchical fit -> out/circuits.json
.venv/bin/python backtest.py   # score against reality -> out/backtest.json
.venv/bin/python export.py     # copy artefacts into web/src/models/
```

`ingest.py` caches every response to `ml/raw/` and is resumable, so re-running costs
nothing.

## History

`RaceMind/` holds the original Expo/React Native prototype. It is superseded and is
kept only for reference. Its data layer never worked: it read `lap.duration` and
`lap.tyre` from OpenF1's `/laps`, but those fields are called `lap_duration` and do not
exist respectively, so the degradation and pit-loss inference always returned `null`
and the analytics table only ever rendered when the API *failed* and mock data took
over. Its fuel model was also inverted, making the car slower as it burned fuel off.
None of that code carried over.
