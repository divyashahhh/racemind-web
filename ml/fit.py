"""Fit the degradation, fuel, pit and safety-car models and export circuits.json.

Modelling approach
------------------
Lap time is modelled as

    t_ij = mu_{driver,race}                      (car pace + driver + track, a fixed effect)
         + phi * fuel_laps_remaining             (fuel burn-off, a physical constant)
         + alpha_c + beta_c * age + gamma_c * age^2   (tyre, per compound)
         + eps

The driver-race intercept is the key to making this identifiable. Without it, a slow
car on hards looks identical to a degraded tyre. We remove it with the within
transformation (demean every variable inside each driver-race group), which is
algebraically equivalent to including a dummy per group but costs nothing.

Fuel and degradation are separable only because drivers pit at *different* laps: the
fuel term keys off lap number, the tyre term off tyre age, and across ~90 races those
two are far from collinear.

Circuits are then partially pooled toward the global fit using an empirical-Bayes
shrinkage weight n/(n+k). Monaco has two races of data and Bahrain has four; pooling
lets the thin circuits borrow strength instead of producing nonsense coefficients.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import lsq_linear

OUT = Path(__file__).parent / "out"
RAW = Path(__file__).parent / "raw"

DRY = ["SOFT", "MEDIUM", "HARD"]
REFERENCE_COMPOUND = "MEDIUM"
# Shrinkage strength: a circuit needs ~this many usable laps per compound before its
# own fit dominates the pooled prior.
SHRINK_K = 400.0
# Degradation is a physical process; these bound the fit away from absurdity when a
# circuit has very little data.
BETA_BOUNDS = (0.0, 0.30)
GAMMA_BOUNDS = (0.0, 0.020)


def design_matrix(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Within-transformed design matrix, parameterised so the compound ordering can be
    imposed as a non-negativity constraint.

    Instead of one free beta per compound, we fit

        beta_HARD   = b0
        beta_MEDIUM = b0 + d1
        beta_SOFT   = b0 + d1 + d2      with b0, d1, d2 >= 0

    which forces SOFT >= MEDIUM >= HARD, and the same for the quadratic terms.

    Two identification problems make these constraints necessary rather than cosmetic:

    1. Tyre age and lap number are *perfectly* collinear inside a stint, so degradation
       and fuel burn-off separate only through across-stint variation. The unconstrained
       fit loads its misspecification onto whichever compound runs the longest stints --
       the hard -- which then comes out degrading faster than the soft.

    2. Survivorship. Teams pit *before* the cliff, so the laps we observe at high tyre
       age are exactly the stints that were going well: cool track, careful driver, a
       good set. That biases the high-age sample fast and makes the observed curve come
       out concave, when the physical curve is convex. Fitted without constraints, gamma
       is negative for all three compounds -- the model would claim tyres stop degrading
       the longer you run them.

    Constraining gamma >= 0 collapses it to ~0 on this data: race laps alone cannot
    identify the cliff, because nobody drives off it on purpose. Identifying it properly
    needs practice long-run data, where teams deliberately run a set to destruction.
    The shipped model is therefore effectively linear in tyre age, and the Model tab
    says so rather than implying a cliff it cannot see.
    """
    age = df["tyre_age"].to_numpy(float)
    fuel = (df["total_laps"] - df["lap_number"]).to_numpy(float)

    is_soft = (df["compound"] == "SOFT").to_numpy(float)
    is_med = (df["compound"] == "MEDIUM").to_numpy(float)
    is_hard = (df["compound"] == "HARD").to_numpy(float)
    any_dry = is_soft + is_med + is_hard

    cols = [
        fuel,                                  # fuel + track evolution, unconstrained
        age * any_dry,                         # b0  : HARD linear
        age * (is_med + is_soft),              # d1  : MEDIUM uplift
        age * is_soft,                         # d2  : SOFT uplift
        age * age * any_dry,                   # g0  : HARD quadratic
        age * age * (is_med + is_soft),        # gd1
        age * age * is_soft,                   # gd2
        -is_soft,                              # s1 : SOFT is faster than MEDIUM by s1
        is_hard,                               # h1 : HARD is slower than MEDIUM by h1
    ]
    names = ["fuel", "b0", "d1", "d2", "g0", "gd1", "gd2", "s1", "h1"]

    X = np.array(np.column_stack(cols), dtype=float, copy=True)
    y = np.array(df["lap_duration"].to_numpy(float), dtype=float, copy=True)

    # Within transformation: demean by driver-race so the group intercept drops out.
    # Equivalent to a dummy per driver-race, but without building the dummy matrix.
    group = (df["session_key"].astype(str) + "_" + df["driver_number"].astype(str)).to_numpy()
    codes, uniques = pd.factorize(group)
    n_groups = len(uniques)

    counts = np.zeros(n_groups)
    np.add.at(counts, codes, 1.0)

    x_sums = np.zeros((n_groups, X.shape[1]))
    np.add.at(x_sums, codes, X)
    X -= (x_sums / counts[:, None])[codes]

    y_sums = np.zeros(n_groups)
    np.add.at(y_sums, codes, y)
    y -= (y_sums / counts)[codes]

    return X, y, names


# Non-negative for every term carrying an ordering or convexity constraint. Only the
# fuel slope is left free; the compound pace offsets are ordered too, because the same
# survivorship that bends the degradation curve also makes the hard look quicker than
# the medium on a fresh tyre, which it never is.
_LOWER = np.array([-np.inf, 0, 0, 0, 0, 0, 0, 0, 0])
_UPPER = np.full(9, np.inf)


def constrained_fit(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Bounded least squares, with standard errors from the unconstrained covariance."""
    result = lsq_linear(X, y, bounds=(_LOWER, _UPPER), max_iter=300)
    beta = result.x
    resid = y - X @ beta
    dof = max(1, len(y) - X.shape[1])
    sigma2 = float(resid @ resid) / dof
    try:
        se = np.sqrt(np.clip(np.diag(sigma2 * np.linalg.pinv(X.T @ X)), 0, None))
    except np.linalg.LinAlgError:
        se = np.full(X.shape[1], np.nan)
    return beta, se


def unpack(beta: np.ndarray, se: np.ndarray) -> dict[str, tuple[float, float]]:
    """Turn the constrained parameterisation back into per-compound coefficients."""
    b0, d1, d2, g0, gd1, gd2 = beta[1], beta[2], beta[3], beta[4], beta[5], beta[6]
    return {
        # Raw constrained components. Shrinkage must be applied to these, not to the
        # derived per-compound values: blending SOFT and MEDIUM independently toward
        # the prior can reorder them and undo the monotonicity constraint.
        "raw_b0": (float(b0), float(se[1])),
        "raw_d1": (float(d1), float(se[2])),
        "raw_d2": (float(d2), float(se[3])),
        "raw_g0": (float(g0), float(se[4])),
        "raw_gd1": (float(gd1), float(se[5])),
        "raw_gd2": (float(gd2), float(se[6])),
        "raw_s1": (float(beta[7]), float(se[7])),
        "raw_h1": (float(beta[8]), float(se[8])),
        "fuel": (float(beta[0]), float(se[0])),
        "beta_HARD": (float(b0), float(se[1])),
        "beta_MEDIUM": (float(b0 + d1), float(np.hypot(se[1], se[2]))),
        "beta_SOFT": (float(b0 + d1 + d2), float(np.hypot(np.hypot(se[1], se[2]), se[3]))),
        "gamma_HARD": (float(g0), float(se[4])),
        "gamma_MEDIUM": (float(g0 + gd1), float(np.hypot(se[4], se[5]))),
        "gamma_SOFT": (float(g0 + gd1 + gd2), float(np.hypot(np.hypot(se[4], se[5]), se[6]))),
        "alpha_SOFT": (float(-beta[7]), float(se[7])),
        "alpha_HARD": (float(beta[8]), float(se[8])),
        "alpha_MEDIUM": (0.0, 0.05),
    }


def fit_group(df: pd.DataFrame) -> dict[str, tuple[float, float]] | None:
    if len(df) < 200:
        return None
    X, y, _ = design_matrix(df)
    beta, se = constrained_fit(X, y)
    return unpack(beta, se)


def clamp(value: float, bounds: tuple[float, float]) -> float:
    return float(min(max(value, bounds[0]), bounds[1]))


def shrink(local: float, glob: float, n: float) -> float:
    w = n / (n + SHRINK_K)
    return w * local + (1 - w) * glob


def fit_pit(session_keys: list[int]) -> tuple[float, float, dict[str, float]]:
    """Per-circuit pit lane loss, plus the log-normal excess on top of a perfect stop.

    /pit reports total time in the pit lane, which already includes the stationary
    stop. Taking a circuit's 5th percentile as its lane loss and then adding a
    separately-estimated stop duration would count the stop twice, inflating every
    pit loss by several seconds. So the excess is measured against each circuit's own
    5th percentile: lane_loss + excess reconstructs the real distribution.
    """
    per_circuit: dict[str, list[float]] = {}
    index = {s["session_key"]: s for s in json.loads((RAW / "index.json").read_text())}
    for key in session_keys:
        path = RAW / str(key) / "pit.json"
        if not path.exists():
            continue
        circuit = index[key]["circuit_short_name"]
        for row in json.loads(path.read_text()):
            d = row.get("pit_duration") or row.get("lane_duration")
            if d is None or not (12 < d < 45):
                continue
            per_circuit.setdefault(circuit, []).append(float(d))

    lane_loss = {c: float(np.percentile(v, 5)) for c, v in per_circuit.items() if len(v) >= 8}

    excesses: list[float] = []
    for circuit, values in per_circuit.items():
        floor = lane_loss.get(circuit)
        if floor is None:
            continue
        excesses.extend(d - floor for d in values if d - floor > 0.2)

    logs = np.log(np.array(excesses))
    return float(logs.mean()), float(logs.std()), lane_loss


def fit_safety_car(session_keys: list[int]) -> dict[str, dict]:
    """Per-circuit safety car deployment rates from race control messages."""
    index = {s["session_key"]: s for s in json.loads((RAW / "index.json").read_text())}
    tally: dict[str, dict] = {}
    for key in session_keys:
        path = RAW / str(key) / "race_control.json"
        if not path.exists():
            continue
        circuit = index[key]["circuit_short_name"]
        entry = tally.setdefault(circuit, {"races": 0, "deployments": 0, "lap_one": 0})
        entry["races"] += 1

        deployed_laps = set()
        for row in json.loads(path.read_text()):
            message = (row.get("message") or "").upper()
            if "SAFETY CAR DEPLOYED" in message or "VIRTUAL SAFETY CAR DEPLOYED" in message:
                lap = row.get("lap_number")
                if lap is not None:
                    deployed_laps.add(int(lap))
        entry["deployments"] += len(deployed_laps)
        if any(l <= 2 for l in deployed_laps):
            entry["lap_one"] += 1
    return tally


def main() -> None:
    df = pd.read_parquet(OUT / "laps.parquet")
    usable = df[df["usable"]].copy()
    print(f"fitting on {len(usable):,} usable laps, {usable['circuit'].nunique()} circuits")

    # --- Global fit (the pooled prior) -------------------------------------------
    global_fit = fit_group(usable)
    assert global_fit is not None, "not enough data for a global fit"
    fuel_effect = clamp(global_fit["fuel"][0], (0.005, 0.15))
    print(f"global fuel effect: {fuel_effect:.4f} s per lap of fuel remaining")
    for c in DRY:
        print(f"  global {c:<7} beta={global_fit[f'beta_{c}'][0]:+.4f} gamma={global_fit[f'gamma_{c}'][0]:+.5f}")

    # --- Per-circuit fits ---------------------------------------------------------
    circuits: dict[str, dict] = {}
    for circuit, group in usable.groupby("circuit"):
        local = fit_group(group)
        races = int(group["session_key"].nunique())
        total_laps = int(df[df["circuit"] == circuit]["total_laps"].median())
        # Reference pace: the 10th percentile green-flag lap, which approximates a
        # low-fuel lap on a fresh nominal tyre.
        base_lap = float(np.percentile(group["lap_duration"], 10))

        # Shrink in the constrained parameterisation, weighting each component by the
        # laps that actually identify it, then derive the per-compound curves. Because
        # every component is non-negative, the blend is too, so SOFT >= MEDIUM >= HARD
        # holds by construction at every circuit no matter how thin its data is.
        counts = {c: float(len(group[group["compound"] == c])) for c in DRY}
        n_dry = sum(counts.values())
        weights = {
            "b0": n_dry, "g0": n_dry,
            "d1": counts["MEDIUM"] + counts["SOFT"], "gd1": counts["MEDIUM"] + counts["SOFT"],
            "d2": counts["SOFT"], "gd2": counts["SOFT"],
            "s1": counts["SOFT"], "h1": counts["HARD"],
        }
        raw = {}
        for name, n_eff in weights.items():
            g_val = global_fit[f"raw_{name}"][0]
            raw[name] = g_val if local is None else shrink(local[f"raw_{name}"][0], g_val, n_eff)

        derived = {
            "SOFT": (
                -raw["s1"],
                raw["b0"] + raw["d1"] + raw["d2"],
                raw["g0"] + raw["gd1"] + raw["gd2"],
            ),
            "MEDIUM": (0.0, raw["b0"] + raw["d1"], raw["g0"] + raw["gd1"]),
            "HARD": (raw["h1"], raw["b0"], raw["g0"]),
        }

        curves = {}
        for c in DRY:
            sub = group[group["compound"] == c]
            n = counts[c]
            a, b, g = derived[c]
            src = global_fit if (local is None or n < 150) else local
            a_se = src[f"alpha_{c}"][1]
            b_se = src[f"beta_{c}"][1]
            g_se = src[f"gamma_{c}"][1]

            curves[c] = {
                "compound": c,
                "alpha": round(float(a), 4),
                "beta": round(clamp(b, BETA_BOUNDS), 5),
                "gamma": round(clamp(g, GAMMA_BOUNDS), 6),
                # NOTE: the clamps are wide sanity bounds only. They must never bind in
                # practice, because clamping per compound could reorder the ladder that
                # the constrained fit and raw-space shrinkage just guaranteed.
                "alphaSd": round(float(np.nan_to_num(a_se, nan=0.08)) + 0.02, 4),
                "betaSd": round(float(np.nan_to_num(b_se, nan=0.01)) + 0.004, 5),
                "gammaSd": round(float(np.nan_to_num(g_se, nan=0.001)) + 0.0004, 6),
                "sampleLaps": int(n),
                "observedMaxStint": int(sub["tyre_age"].max()) if len(sub) else 0,
            }

        circuits[circuit] = {
            "key": circuit,
            "name": circuit,
            "raceLaps": total_laps,
            "baseLapTime": round(base_lap, 3),
            "fuelEffect": round(fuel_effect, 5),
            "curves": curves,
            "racesObserved": races,
        }

    # --- Pit and safety car -------------------------------------------------------
    keys = [int(k) for k in df["session_key"].unique()]
    pit_mu, pit_sigma, lane_loss = fit_pit(keys)
    print(f"pit stop: median stationary {np.exp(pit_mu):.2f}s, log-sd {pit_sigma:.3f}")

    sc = fit_safety_car(keys)
    for circuit, model in circuits.items():
        model["pitLaneLoss"] = round(lane_loss.get(circuit, float(np.median(list(lane_loss.values())))), 2)
        model["pitStopMu"] = round(pit_mu, 4)
        model["pitStopSigma"] = round(pit_sigma, 4)
        # Lap-to-lap noise from the residual spread of usable laps at this circuit.
        sub = usable[usable["circuit"] == circuit]
        model["noiseSd"] = round(float(min(1.2, max(0.15, sub["lap_duration"].std() * 0.12))), 3)
        model["noiseRho"] = 0.55

        tally = sc.get(circuit, {"races": 0, "deployments": 0, "lap_one": 0})
        races = max(1, tally["races"])
        # Beta(1,1) smoothing so a circuit with one clean race is not assigned a
        # zero safety-car probability.
        per_race = (tally["deployments"] + 1) / (races + 2)
        model["safetyCar"] = {
            "lapOneRate": round((tally["lap_one"] + 0.5) / (races + 2), 4),
            "perLapRate": round(min(0.05, per_race / max(1, model["raceLaps"])), 5),
            "meanDuration": 4.0,
            "pitLossDiscount": 0.45,
            "lapTimeMultiplier": 1.4,
        }

    payload = {
        "version": 1,
        "fittedAt": pd.Timestamp.utcnow().isoformat(),
        "usableLaps": int(len(usable)),
        "races": int(df["session_key"].nunique()),
        "seasons": sorted(int(y) for y in df["year"].unique()),
        "global": {
            "fuelEffect": round(fuel_effect, 5),
            "pitStopMu": round(pit_mu, 4),
            "pitStopSigma": round(pit_sigma, 4),
        },
        "circuits": circuits,
    }
    dest = OUT / "circuits.json"
    dest.write_text(json.dumps(payload, indent=2))
    print(f"\n{len(circuits)} circuits -> {dest}")


if __name__ == "__main__":
    main()
