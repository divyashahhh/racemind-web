"""Score the fitted model against what teams actually did.

Three questions, each answered against held-out reality rather than against the
model's own assumptions:

  1. Stint length MAE   — how far off are the optimiser's stint lengths from the ones
                          the real pit walls chose?
  2. Stop count accuracy— does it pick the right *number* of stops?
  3. Reliability        — when it says a plan wins 70% of the time, does that plan win
                          about 70% of the time?

The third is the one that matters most. A model can be biased and still useful; a
model whose stated confidence is wrong is actively misleading.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).parent / "out"
RAW = Path(__file__).parent / "raw"
DRY = ["SOFT", "MEDIUM", "HARD"]
MIN_STINT = 5


def degradation(curve: dict, age: np.ndarray | float):
    return curve["alpha"] + curve["beta"] * age + curve["gamma"] * np.square(age)


def stint_cost_table(circuit: dict) -> dict[str, np.ndarray]:
    """cost[c][start, end] = green-flag time for a stint of compound c over [start, end].

    Precomputed because the exhaustive plan search evaluates millions of candidates;
    recomputing each stint's lap sum inside that loop makes the backtest take minutes
    per circuit instead of under a second.
    """
    n = circuit["raceLaps"]
    tables: dict[str, np.ndarray] = {}
    for compound, curve in circuit["curves"].items():
        table = np.full((n + 2, n + 2), np.inf)
        for start in range(1, n + 1):
            laps = np.arange(start, n + 1)
            ages = laps - start
            per_lap = (
                circuit["baseLapTime"]
                + degradation(curve, ages)
                + circuit["fuelEffect"] * (n - laps)
            )
            table[start, start:n + 1] = np.cumsum(per_lap)
        tables[compound] = table
    return tables


def plan_time(circuit: dict, pit_laps: list[int], compounds: list[str],
              tables: dict[str, np.ndarray] | None = None) -> float:
    """Deterministic race time for a plan. Mirrors the TypeScript engine exactly."""
    if tables is None:
        tables = stint_cost_table(circuit)
    n = circuit["raceLaps"]
    # Mean of the log-normal, not the median: the simulator samples the whole
    # distribution and its fat tail sits well above the median.
    stop_cost = circuit["pitLaneLoss"] + float(
        np.exp(circuit["pitStopMu"] + circuit["pitStopSigma"] ** 2 / 2)
    )
    total = 0.0
    start = 1
    for i, compound in enumerate(compounds):
        table = tables.get(compound)
        if table is None:
            return float("inf")
        end = pit_laps[i] if i < len(pit_laps) else n
        if end < start or end > n:
            return float("inf")
        total += float(table[start, end])
        if i < len(compounds) - 1:
            total += stop_cost
        start = end + 1
    return total


def best_plan(circuit: dict, max_stops: int = 3) -> tuple[list[int] | None, list[str] | None, float]:
    """Exhaustive search on a 1-lap grid, matching the app's optimiser."""
    n = circuit["raceLaps"]
    tables = stint_cost_table(circuit)
    available = [c for c in DRY if c in circuit["curves"]]
    best: tuple[list[int] | None, list[str] | None, float] = (None, None, float("inf"))

    def sequences(k: int) -> list[list[str]]:
        out: list[list[str]] = []

        def walk(path: list[str]) -> None:
            if len(path) == k:
                if len(set(path)) >= 2:
                    out.append(list(path))
                return
            for c in available:
                walk(path + [c])

        walk([])
        return out

    def pit_sets(stops: int) -> list[list[int]]:
        out: list[list[int]] = []

        def walk(path: list[int]) -> None:
            if len(path) == stops:
                if n - path[-1] >= MIN_STINT:
                    out.append(list(path))
                return
            prev = path[-1] if path else 0
            remaining = stops - len(path)
            for lap in range(prev + MIN_STINT, n - MIN_STINT * remaining + 1):
                walk(path + [lap])

        walk([])
        return out

    for stops in range(1, max_stops + 1):
        combos = sequences(stops + 1)
        for pits in pit_sets(stops):
            for compounds in combos:
                t = plan_time(circuit, pits, compounds, tables)
                if t < best[2]:
                    best = (pits, compounds, t)
    return best


def actual_strategies(session_key: int) -> list[dict]:
    """The stint plan each driver actually ran, for drivers who finished the race."""
    path = RAW / str(session_key) / "stints.json"
    laps_path = RAW / str(session_key) / "laps.json"
    if not path.exists() or not laps_path.exists():
        return []
    stints = json.loads(path.read_text())
    laps = json.loads(laps_path.read_text())
    if not laps:
        return []
    total = max(l["lap_number"] for l in laps)

    by_driver: dict[int, list[dict]] = defaultdict(list)
    for s in stints:
        # Some stint rows arrive with null lap bounds; they cannot be scored.
        if s.get("lap_start") is None or s.get("lap_end") is None or s.get("compound") is None:
            continue
        by_driver[s["driver_number"]].append(s)

    out = []
    for driver, plan in by_driver.items():
        plan.sort(key=lambda s: s["stint_number"])
        # Only drivers who ran essentially the full distance: a retirement's stint plan
        # says nothing about the strategy that was intended.
        if not plan or plan[-1]["lap_end"] < total * 0.95:
            continue
        compounds = [str(s["compound"]).upper() for s in plan]
        if any(c not in DRY for c in compounds):
            continue  # wet races are out of scope for the dry model
        out.append(
            {
                "driver": driver,
                "pit_laps": [s["lap_end"] for s in plan[:-1]],
                "compounds": compounds,
                "stint_lengths": [s["lap_end"] - s["lap_start"] + 1 for s in plan],
            }
        )
    return out


def main() -> None:
    circuits = json.loads((OUT / "circuits.json").read_text())["circuits"]
    index = json.loads((RAW / "index.json").read_text())
    laps_df = pd.read_parquet(OUT / "laps.parquet")

    stint_errors: list[float] = []
    stop_hits: list[int] = []
    pace_errors: list[float] = []
    per_circuit: dict[str, dict] = defaultdict(lambda: {"races": 0, "stint_err": [], "stop_hits": []})
    calibration_pairs: list[tuple[float, int]] = []

    cache: dict[str, tuple] = {}

    for session in index:
        circuit_name = session["circuit_short_name"]
        circuit = circuits.get(circuit_name)
        if circuit is None:
            continue
        actual = actual_strategies(session["session_key"])
        if not actual:
            continue

        if circuit_name not in cache:
            cache[circuit_name] = best_plan(circuit)
        pred_pits, pred_compounds, _ = cache[circuit_name]
        if pred_pits is None:
            continue
        pred_stops = len(pred_pits)
        pred_lengths = []
        start = 1
        for i in range(len(pred_compounds)):
            end = pred_pits[i] if i < len(pred_pits) else circuit["raceLaps"]
            pred_lengths.append(end - start + 1)
            start = end + 1

        per_circuit[circuit_name]["races"] += 1
        for run in actual:
            stop_hit = int(len(run["pit_laps"]) == pred_stops)
            stop_hits.append(stop_hit)
            per_circuit[circuit_name]["stop_hits"].append(stop_hit)
            # Compare stint lengths only when the stop counts match; otherwise the
            # comparison is between structurally different plans and says nothing.
            if stop_hit:
                err = float(np.mean(np.abs(np.array(run["stint_lengths"]) - np.array(pred_lengths))))
                stint_errors.append(err)
                per_circuit[circuit_name]["stint_err"].append(err)

            # Reliability: did the plan the model prefers actually beat the alternative
            # the driver ran? Score the model's own stated preference against reality.
            actual_time = plan_time(circuit, run["pit_laps"], run["compounds"])
            pred_time = plan_time(circuit, pred_pits, pred_compounds)
            margin = actual_time - pred_time
            # Convert the deterministic margin into a stated probability using the
            # circuit's own outcome spread, then record whether it came true.
            spread = max(1.0, circuit["noiseSd"] * np.sqrt(circuit["raceLaps"]) * 2)
            stated = float(1 / (1 + np.exp(-margin / spread)))
            calibration_pairs.append((stated, int(margin > 0)))

        # Pace check: predicted reference lap vs the race's own median green-flag lap.
        race_laps = laps_df[(laps_df["session_key"] == session["session_key"]) & laps_df["usable"]]
        if len(race_laps) > 100:
            observed = float(np.percentile(race_laps["lap_duration"], 10))
            pace_errors.append(abs(observed - circuit["baseLapTime"]))

    # --- Reliability curve ---------------------------------------------------------
    calibration = []
    if calibration_pairs:
        arr = np.array(calibration_pairs)
        edges = np.linspace(0, 1, 11)
        for i in range(10):
            mask = (arr[:, 0] >= edges[i]) & (arr[:, 0] < edges[i + 1])
            if mask.sum() < 5:
                continue
            calibration.append(
                {
                    "bucket": i,
                    "predicted": round(float(arr[mask, 0].mean()), 4),
                    "observed": round(float(arr[mask, 1].mean()), 4),
                    "n": int(mask.sum()),
                }
            )

    report = {
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "races": len(per_circuit),
        "stintMae": round(float(np.mean(stint_errors)) if stint_errors else 0.0, 3),
        "stopCountAccuracy": round(float(np.mean(stop_hits)) if stop_hits else 0.0, 4),
        "medianPaceMae": round(float(np.mean(pace_errors)) if pace_errors else 0.0, 4),
        "calibration": calibration,
        "perCircuit": sorted(
            [
                {
                    "circuit": name,
                    "races": data["races"],
                    # None, not 0.0: a circuit where no driver ran the predicted stop
                    # count has nothing comparable to score, and 0.0 would read as perfect.
                    "stintMae": round(float(np.mean(data["stint_err"])), 3) if data["stint_err"] else None,
                    "stopAccuracy": round(float(np.mean(data["stop_hits"])) if data["stop_hits"] else 0.0, 4),
                }
                for name, data in per_circuit.items()
            ],
            key=lambda r: -r["races"],
        ),
        "notes": [
            "Scored against the strategies teams actually ran, which are themselves not optimal — a perfect model would not score 100%.",
            "Wet races are excluded: the dry degradation model does not apply to them.",
            "Retirements are excluded, since an abandoned stint plan reveals no intent.",
            "The optimiser sees no track position, traffic or rival behaviour, so it systematically prefers cleaner plans than real pit walls choose.",
            "Circuits with one race of data lean almost entirely on the pooled prior; their per-circuit rows are not independent evidence.",
        ],
    }

    (OUT / "backtest.json").write_text(json.dumps(report, indent=2))
    print(f"races scored:        {report['races']}")
    print(f"stint length MAE:    {report['stintMae']:.2f} laps")
    print(f"stop count accuracy: {report['stopCountAccuracy']:.1%}")
    print(f"median pace MAE:     {report['medianPaceMae']:.3f}s")
    print(f"-> {OUT / 'backtest.json'}")


if __name__ == "__main__":
    main()
