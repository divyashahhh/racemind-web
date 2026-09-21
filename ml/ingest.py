"""Pull every completed race session from OpenF1 into ml/raw/.

Usage:  python ingest.py [year ...]      (defaults to 2023-2026)

Only endpoints the modelling actually consumes are pulled. Position/interval
streams are deliberately skipped: they are ~36k rows per session and the undercut
model derives gap dynamics analytically from the degradation curves instead.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from openf1_client import RAW, fetch

SESSION_ENDPOINTS = ("laps", "stints", "pit", "drivers", "weather", "race_control")
DEFAULT_YEARS = (2023, 2024, 2025, 2026)


def completed_races(year: int) -> list[dict]:
    sessions = fetch("sessions", f"sessions_{year}", year=year, session_name="Race")
    now = datetime.now(timezone.utc)
    out = []
    for s in sessions:
        if s.get("is_cancelled"):
            continue
        end = s.get("date_end")
        if end and datetime.fromisoformat(end) > now:
            continue  # not run yet
        out.append(s)
    return out


def main(years: tuple[int, ...]) -> None:
    index: list[dict] = []
    for year in years:
        races = completed_races(year)
        print(f"{year}: {len(races)} completed races", flush=True)
        for s in races:
            key = s["session_key"]
            counts = {}
            for endpoint in SESSION_ENDPOINTS:
                try:
                    counts[endpoint] = len(fetch(endpoint, f"{key}/{endpoint}", session_key=key))
                except Exception as exc:  # one bad endpoint must not sink the run
                    counts[endpoint] = -1
                    print(f"  !! {s['circuit_short_name']} {endpoint}: {exc}", flush=True)
            summary = " ".join(f"{e}={counts[e]}" for e in SESSION_ENDPOINTS)
            print(f"  {year} {s['circuit_short_name']:<16} {summary}", flush=True)
            index.append(s)

    (RAW / "index.json").write_text(json.dumps(index, indent=2))
    print(f"\nindexed {len(index)} sessions -> {RAW / 'index.json'}")


if __name__ == "__main__":
    args = tuple(int(a) for a in sys.argv[1:]) or DEFAULT_YEARS
    main(args)
