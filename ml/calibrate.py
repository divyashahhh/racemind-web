"""Recover the tyre cliff from revealed preference, then rewrite circuits.json.

The problem this solves
-----------------------
Race lap times cannot identify the degradation cliff: teams pit *before* it, so every
high-age lap in the dataset belongs to a stint that was going well. Fitted honestly,
gamma collapses to ~0 and the model becomes linear in tyre age — and a linear model
almost always prefers one stop, because there is no accelerating penalty for running long.

The consequence is visible and embarrassing: at Sakhir the simulator calls a one-stop
while the evidence panel beside it reports that 79% of real finishers ran two.

The fix
-------
Teams' chosen stint lengths are themselves data. A pit wall with far better information
than this model decided, race after race, to stop twice at Sakhir and once at Monza.
That choice encodes the cliff the lap times censor. So rather than read the cliff off
lap times, we invert the decision: find the smallest gamma that makes the observed modal
stop count optimal under the model.

This is inverse optimisation / revealed preference, and it is honest as long as it is
labelled — the resulting gamma is calibrated to team behaviour, not measured from pace.
Both the Model page and this docstring say so.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np

RAW = Path(__file__).parent / "raw"
OUT = Path(__file__).parent / "out"

DRY = ["SOFT", "MEDIUM", "HARD"]
MIN_STINT = 5
# Search grid for the added curvature, in s/lap^2. 0.006 at age 30 is ~5.4s, far past
# any real cliff, so the upper bound never binds in practice.
GAMMA_GRID = np.concatenate([[0.0], np.linspace(0.0002, 0.014, 70)])


def observed_modal_stops(history: list[dict]) -> tuple[int, int, int] | None:
    """(modal stop count, how many finishers chose it, total dry finishers)."""
    counts: Counter[int] = Counter()
    for race in history:
        for entry in race["entries"]:
            if entry["finished"] and entry["allDry"] and entry["stops"] <= 4:
                counts[entry["stops"]] += 1
    if not counts:
        return None
    stops, n = counts.most_common(1)[0]
    return stops, n, sum(counts.values())


def stint_cost_tables(circuit: dict, gammas: dict[str, float]) -> dict[str, np.ndarray]:
    n = circuit["raceLaps"]
    tables: dict[str, np.ndarray] = {}
    for compound, curve in circuit["curves"].items():
        table = np.full((n + 2, n + 2), np.inf)
        for start in range(1, n + 1):
            laps = np.arange(start, n + 1)
            ages = laps - start
            per_lap = (
                circuit["baseLapTime"]
                + curve["alpha"]
                + curve["beta"] * ages
                + gammas[compound] * ages**2
                + circuit["fuelEffect"] * (n - laps)
            )
            table[start, start : n + 1] = np.cumsum(per_lap)
        tables[compound] = table
    return tables


def best_stop_count(circuit: dict, gammas: dict[str, float], max_stops: int = 3) -> int:
    """Stop count of the fastest legal plan under these coefficients."""
    n = circuit["raceLaps"]
    tables = stint_cost_tables(circuit, gammas)
    # Mean of the log-normal, not the median: the simulator samples the whole
    # distribution and its fat tail sits well above the median.
    stop_cost = circuit["pitLaneLoss"] + float(
        np.exp(circuit["pitStopMu"] + circuit["pitStopSigma"] ** 2 / 2)
    )
    available = [c for c in DRY if c in circuit["curves"]]

    best_time = np.inf
    best_stops = 1

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

    for stops in range(1, max_stops + 1):
        combos = sequences(stops + 1)

        def walk_laps(path: list[int]) -> None:
            nonlocal best_time, best_stops
            if len(path) == stops:
                if n - path[-1] < MIN_STINT:
                    return
                for compounds in combos:
                    total = stops * stop_cost
                    start = 1
                    ok = True
                    for i, compound in enumerate(compounds):
                        end = path[i] if i < len(path) else n
                        value = tables[compound][start, end]
                        if not np.isfinite(value):
                            ok = False
                            break
                        total += value
                        start = end + 1
                    if ok and total < best_time:
                        best_time = total
                        best_stops = stops
                return
            prev = path[-1] if path else 0
            remaining = stops - len(path)
            for lap in range(prev + MIN_STINT, n - MIN_STINT * remaining + 1):
                walk_laps(path + [lap])

        walk_laps([])

    return best_stops


def main() -> None:
    payload = json.loads((OUT / "circuits.json").read_text())
    context = json.loads((OUT / "context.json").read_text())
    circuits = payload["circuits"]

    print(f"{'circuit':<20}{'observed':>9}{'before':>8}{'after':>7}{'gamma+':>10}  support")
    calibrated = 0
    for name, circuit in circuits.items():
        observed = observed_modal_stops(context["history"].get(name, []))
        if observed is None:
            circuit["gammaCalibration"] = None
            continue
        target, n_target, n_total = observed

        # Relative curvature per compound, so the SOFT >= MEDIUM >= HARD ordering the
        # constrained fit established survives the calibration.
        betas = {c: circuit["curves"][c]["beta"] for c in DRY if c in circuit["curves"]}
        ref = max(betas.values()) or 1.0
        shape = {c: (b / ref if ref else 1.0) for c, b in betas.items()}
        fitted = {c: circuit["curves"][c]["gamma"] for c in betas}

        before = best_stop_count(circuit, fitted)
        chosen = 0.0
        after = before
        for delta in GAMMA_GRID:
            gammas = {c: fitted[c] + delta * shape[c] for c in betas}
            stops = best_stop_count(circuit, gammas)
            if stops >= target:
                chosen = float(delta)
                after = stops
                break
        else:
            chosen = float(GAMMA_GRID[-1])
            after = best_stop_count(circuit, {c: fitted[c] + chosen * shape[c] for c in betas})

        for c in betas:
            circuit["curves"][c]["gamma"] = round(fitted[c] + chosen * shape[c], 6)
            # Calibrated curvature is inferred, not measured, so its uncertainty is at
            # least as large as the adjustment itself.
            circuit["curves"][c]["gammaSd"] = round(
                max(circuit["curves"][c]["gammaSd"], chosen * shape[c] * 0.5), 6
            )

        circuit["gammaCalibration"] = {
            "observedModalStops": target,
            "support": f"{n_target}/{n_total}",
            "stopsBefore": before,
            "stopsAfter": after,
            "gammaAdded": round(chosen, 6),
        }
        if chosen > 0:
            calibrated += 1
        print(f"{name:<20}{target:>9}{before:>8}{after:>7}{chosen:>10.5f}  {n_target}/{n_total}")

    payload["calibration"] = {
        "method": "revealed-preference (inverse optimisation on observed modal stop count)",
        "circuitsAdjusted": calibrated,
        "note": (
            "Race lap times cannot identify the tyre cliff because teams pit before it. "
            "Gamma is therefore calibrated so that the stop count teams actually chose is "
            "optimal under the model. It is inferred from behaviour, not measured from pace."
        ),
    }
    (OUT / "circuits.json").write_text(json.dumps(payload, indent=2))
    print(f"\n{calibrated}/{len(circuits)} circuits required added curvature")


if __name__ == "__main__":
    main()
