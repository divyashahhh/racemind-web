# RaceMind

**Call the strategy before the pit wall does.**

An F1 strategy predictor for fans. Pick your team, your driver and a 2027 race, set the
conditions you expect, and get one answer — how many stops, which tyres, and which laps
to box on — with the real historical evidence sitting next to it so you can check the
call rather than take it on faith.

```
racemind/
├── web/        the app (Vite + React + TypeScript + Tailwind, no backend)
├── ml/         the offline modelling pipeline (Python)
└── RaceMind/   the original Expo prototype, superseded — see "History"
```

## Quick start

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

No backend and no API keys. The fitted model ships as static JSON, the Monte Carlo runs
in a Web Worker in the browser.

```bash
npm run test       # 39 tests
npm run build      # ~110 KB gzipped app + 30 KB data chunk
```

## The three pages

**Predict** — the whole product. Team, driver, race, grid slot, track temperature and
rain risk go in; one call comes out, with its confidence, its pit windows, and the
alternatives it beat. Underneath sit four evidence cards and your team's actual record
at that circuit — real compounds, real stint lengths, real finishing positions.

**Calendar** — all 24 rounds of 2027, including the two the model refuses to predict.

**Model** — every technical claim, in one place: the lap-time equation, how the fit
works, how the cliff is recovered, the backtest, and the things it gets wrong.

## How the prediction works

```
t(lap) = base_pace
       + α_compound + β·age + γ·age²    tyre
       + φ·(race_laps − lap)            fuel burn-off
       + traffic(lap, grid)             dirty air, opening stint only
       + ε                              AR(1) noise
```

Fitted on **66,278 green-flag laps from 84 races across 2023–2026**, after dropping
in-laps, out-laps, safety-car laps and outliers (~29% of all laps). A driver-race
intercept is removed with a within transformation so a slow car on hards is not mistaken
for a degraded tyre, and circuits are partially pooled so thin tracks borrow strength.

Seasons are **era-weighted** — 2026 laps count fully, 2023 laps at 5% — because the 2026
regulation change means an older lap says much less about 2027.

Prediction is a lap-discretised **Monte Carlo**, 1,500 runs, sampling degradation
posteriors, AR(1) noise, log-normal pit stops, per-circuit safety-car hazards and rain.
Every candidate plan is scored against the *same* sampled race, so the confidence figure
is the share of races a plan actually won — not a comparison of medians.

## Honest limitations

All of these are stated in the app's Model tab too, not just buried here.

**The tyre cliff is recovered from behaviour, not measured.** Race lap times cannot
identify it: teams pit *before* the cliff, so every high-age lap belongs to a stint that
was going well. Fitted honestly, γ comes out *negative* — the model would claim tyres
stop degrading with age. So γ is instead set to the smallest value that makes the stop
count teams actually chose come out optimal (inverse optimisation on revealed
preference). 11 of 25 circuits needed any adjustment. **This makes the stop-count
accuracy below partly circular**; stint-length error is the cleaner signal, since stint
lengths were never targeted.

**The compound ladder is imposed.** Tyre age and lap number are perfectly collinear
within a stint, so degradation and fuel separate only across stints, and the
unconstrained fit makes the hard degrade faster than the soft. SOFT ≥ MEDIUM ≥ HARD is
encoded as a constraint.

**No track position.** The simulator races a stopwatch, not other cars. Grid slot is
modelled as opening-stint dirty air, but there is no overtaking, no defending and no
rival reacting to your stop. This is the largest gap.

**Rain is priced, not solved.** The rain slider widens the spread of outcomes but does
not pick intermediates — wet compounds are never fitted or offered. A genuinely wet race
is outside this model, and the UI says so.

**Two 2027 rounds get no prediction at all.** Portimão and Istanbul return to the
calendar but have not been raced since 2021, before the data begins. RaceMind shows
nothing for them rather than dressing up a guess.

**Backtest:** 61% stop-count accuracy, 7.7 laps stint MAE against what teams actually
did. Teams' own choices are not optimal either, so 100% would itself be a red flag.

## Rebuilding the model

```bash
cd ml
python3 -m venv .venv && .venv/bin/pip install numpy pandas scipy requests pyarrow

.venv/bin/python ingest.py     # ~20 min, throttled to OpenF1's 3 req/s + 30 req/min
.venv/bin/python clean.py      # filter to green-flag laps  -> out/laps.parquet
.venv/bin/python fit.py        # era-weighted constrained fit -> out/circuits.json
.venv/bin/python context.py    # 2027 calendar, grid, history -> out/context.json
.venv/bin/python calibrate.py  # recover the cliff from revealed preference (rewrites circuits.json)
.venv/bin/python backtest.py   # score against reality       -> out/backtest.json
.venv/bin/python export.py     # copy artefacts into web/src/models/
```

Order matters: `calibrate.py` needs `context.json` and rewrites `circuits.json` in
place, so always re-run `fit.py` before it rather than calibrating twice.
`ingest.py` caches every response to `ml/raw/` and is resumable.

## Design

Dark near-black ground, mint-teal accent, F1 red reserved for live and urgent states,
oversized tabular numerals. Built with Tailwind v4 + Radix primitives in the
shadcn/21st.dev idiom, so registry components drop in without adaptation.

## History

`RaceMind/` holds the original Expo/React Native prototype, kept for reference and
excluded from this repo (it carries its own git history). Its data layer never worked:
it read `lap.duration` and `lap.tyre` from OpenF1's `/laps`, but those fields are called
`lap_duration` and do not exist respectively — compounds live on `/stints`. So
degradation and pit-loss inference always returned `null`, and the analytics table only
rendered when the API *failed* and mock data took over. Its fuel model was inverted too.
None of that code carried over.

## Disclaimer

A fan tool, not a betting product. Not affiliated with Formula 1. Race data from
[OpenF1](https://openf1.org).
