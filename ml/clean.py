"""Turn raw OpenF1 JSON into a clean per-lap modelling table.

Filtering is the whole game here. A raw lap table is dominated by laps that say
nothing about tyre degradation: in-laps, out-laps, safety-car laps, and laps spent
stuck behind another car. Fitting on unfiltered data produces degradation rates that
are wildly too high and stint recommendations that are far too short.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).parent / "raw"
OUT = Path(__file__).parent / "out"

# A lap slower than this multiple of the driver's own session median is not a
# representative green-flag lap, whatever the cause.
OUTLIER_MULTIPLE = 1.07


def _load(session_key: int, endpoint: str) -> list[dict]:
    path = RAW / str(session_key) / f"{endpoint}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text())


def safety_car_laps(session_key: int, laps: pd.DataFrame) -> set[tuple[int, int]]:
    """(driver_number, lap_number) pairs run under SC, VSC, or yellow."""
    control = _load(session_key, "race_control")
    if not control or laps.empty:
        return set()

    flagged_laps: set[int] = set()
    for row in control:
        category = (row.get("category") or "").upper()
        message = (row.get("message") or "").upper()
        is_neutralised = (
            category in {"SAFETYCAR", "SAFETY CAR"}
            or "SAFETY CAR" in message
            or "VIRTUAL SAFETY CAR" in message
            or "VSC" in message
            or category == "FLAG" and (row.get("flag") or "").upper() in {"RED", "YELLOW", "DOUBLE YELLOW"}
        )
        if not is_neutralised:
            continue
        lap = row.get("lap_number")
        if lap is None:
            continue
        # Neutralisation persists for several laps; blank a conservative window.
        for offset in range(0, 4):
            flagged_laps.add(int(lap) + offset)

    return {(int(d), int(l)) for d in laps["driver_number"].unique() for l in flagged_laps}


def build_lap_table(session: dict) -> pd.DataFrame:
    """One row per usable green-flag lap, annotated with compound and tyre age."""
    key = session["session_key"]
    laps = pd.DataFrame(_load(key, "laps"))
    stints = pd.DataFrame(_load(key, "stints"))
    if laps.empty or stints.empty:
        return pd.DataFrame()

    laps = laps[laps["lap_duration"].notna()].copy()
    if laps.empty:
        return pd.DataFrame()
    laps["lap_number"] = laps["lap_number"].astype(int)
    laps["driver_number"] = laps["driver_number"].astype(int)

    # --- Attach compound and tyre age from /stints -------------------------------
    # This is the ground truth the old engine tried and failed to infer from a
    # non-existent `tyre` field on /laps.
    rows = []
    for _, st in stints.iterrows():
        if pd.isna(st.get("compound")) or pd.isna(st.get("lap_start")) or pd.isna(st.get("lap_end")):
            continue
        age_at_start = st.get("tyre_age_at_start")
        age_at_start = 0 if pd.isna(age_at_start) else int(age_at_start)
        for lap in range(int(st["lap_start"]), int(st["lap_end"]) + 1):
            rows.append(
                {
                    "driver_number": int(st["driver_number"]),
                    "lap_number": lap,
                    "compound": str(st["compound"]).upper(),
                    "stint_number": int(st["stint_number"]),
                    "tyre_age": lap - int(st["lap_start"]) + age_at_start,
                    "stint_lap_start": int(st["lap_start"]),
                    "stint_lap_end": int(st["lap_end"]),
                }
            )
    stint_laps = pd.DataFrame(rows)
    if stint_laps.empty:
        return pd.DataFrame()

    df = laps.merge(stint_laps, on=["driver_number", "lap_number"], how="inner")
    if df.empty:
        return pd.DataFrame()

    # --- Exclusions ---------------------------------------------------------------
    df["is_out_lap"] = df["is_pit_out_lap"].fillna(False).astype(bool)
    df["is_in_lap"] = df["lap_number"] == df["stint_lap_end"]
    sc = safety_car_laps(key, df)
    df["is_sc"] = [
        (d, l) in sc for d, l in zip(df["driver_number"], df["lap_number"])
    ]

    # Per-driver median of their own plausible laps, so a slow car is not treated as
    # a degraded tyre.
    plausible = df[(df["lap_duration"] > 50) & (df["lap_duration"] < 220)]
    medians = plausible.groupby("driver_number")["lap_duration"].median()
    df["driver_median"] = df["driver_number"].map(medians)
    df["is_outlier"] = df["lap_duration"] > df["driver_median"] * OUTLIER_MULTIPLE

    df["usable"] = (
        ~df["is_out_lap"]
        & ~df["is_in_lap"]
        & ~df["is_sc"]
        & ~df["is_outlier"]
        & df["lap_duration"].between(50, 220)
        & df["compound"].isin(["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"])
    )

    df["session_key"] = key
    df["circuit"] = session["circuit_short_name"]
    df["year"] = session["year"]
    df["total_laps"] = int(laps["lap_number"].max())
    return df


def main() -> None:
    index = json.loads((RAW / "index.json").read_text())
    frames = [build_lap_table(s) for s in index]
    frames = [f for f in frames if not f.empty]
    df = pd.concat(frames, ignore_index=True)

    OUT.mkdir(parents=True, exist_ok=True)
    keep = [
        "session_key", "circuit", "year", "driver_number", "lap_number", "lap_duration",
        "compound", "tyre_age", "stint_number", "total_laps", "usable",
        "is_out_lap", "is_in_lap", "is_sc", "is_outlier",
    ]
    df[keep].to_parquet(OUT / "laps.parquet", index=False)

    n_total = len(df)
    n_usable = int(df["usable"].sum())
    print(f"{n_total:,} laps across {df['session_key'].nunique()} races")
    print(f"{n_usable:,} usable ({n_usable / n_total:.1%}) after filtering")
    for reason in ("is_out_lap", "is_in_lap", "is_sc", "is_outlier"):
        print(f"  dropped by {reason:<12} {int(df[reason].sum()):>7,}")
    print(f"-> {OUT / 'laps.parquet'}")


if __name__ == "__main__":
    main()
