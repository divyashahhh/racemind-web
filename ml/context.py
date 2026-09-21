"""Build the fan-facing context artefact: 2027 calendar, teams, and real history.

The app's job is to answer "what will my team do at this race?", which needs three
things the coefficient file does not carry: the 2027 schedule, who is racing, and what
teams have actually done at each circuit before. That last one is the evidence panel —
a prediction the user cannot check against reality is just an assertion.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).parent / "raw"
OUT = Path(__file__).parent / "out"

# The 2027 championship as announced: 24 rounds, 10 sprints. `circuit` is the key used
# by the fitted model; None means the model has never seen this track.
CALENDAR_2027 = [
    (1,  "Bahrain",       "Bahrain Grand Prix",        "Sakhir",             "BH", "2027-03-14", True,  "Sakhir"),
    (2,  "Saudi Arabia",  "Saudi Arabian Grand Prix",  "Jeddah",             "SA", "2027-03-21", False, "Jeddah"),
    (3,  "Australia",     "Australian Grand Prix",     "Melbourne",          "AU", "2027-04-04", True,  "Melbourne"),
    (4,  "Japan",         "Japanese Grand Prix",       "Suzuka",             "JP", "2027-04-11", True,  "Suzuka"),
    (5,  "China",         "Chinese Grand Prix",        "Shanghai",           "CN", "2027-04-18", False, "Shanghai"),
    (6,  "United States", "Miami Grand Prix",          "Miami",              "US", "2027-05-02", False, "Miami"),
    (7,  "Canada",        "Canadian Grand Prix",       "Montreal",           "CA", "2027-05-23", True,  "Montreal"),
    (8,  "Monaco",        "Monaco Grand Prix",         "Monte Carlo",        "MC", "2027-06-06", True,  "Monte Carlo"),
    (9,  "Portugal",      "Portuguese Grand Prix",     "Portimao",           "PT", "2027-06-20", False, None),
    (10, "Great Britain", "British Grand Prix",        "Silverstone",        "GB", "2027-07-04", True,  "Silverstone"),
    (11, "Austria",       "Austrian Grand Prix",       "Spielberg",          "AT", "2027-07-11", False, "Spielberg"),
    (12, "Belgium",       "Belgian Grand Prix",        "Spa-Francorchamps",  "BE", "2027-07-25", False, "Spa-Francorchamps"),
    (13, "Hungary",       "Hungarian Grand Prix",      "Hungaroring",        "HU", "2027-08-01", False, "Hungaroring"),
    (14, "Italy",         "Italian Grand Prix",        "Monza",              "IT", "2027-09-05", True,  "Monza"),
    (15, "Spain",         "Spanish Grand Prix",        "Madring",            "ES", "2027-09-12", False, "Madring"),
    (16, "Azerbaijan",    "Azerbaijan Grand Prix",     "Baku",               "AZ", "2027-09-26", False, "Baku"),
    (17, "Turkiye",       "Turkish Grand Prix",        "Istanbul Park",      "TR", "2027-10-03", False, None),
    (18, "Singapore",     "Singapore Grand Prix",      "Singapore",          "SG", "2027-10-10", False, "Singapore"),
    (19, "United States", "United States Grand Prix",  "Austin",             "US", "2027-10-24", False, "Austin"),
    (20, "Mexico",        "Mexico City Grand Prix",    "Mexico City",        "MX", "2027-10-31", False, "Mexico City"),
    (21, "Brazil",        "Brazilian Grand Prix",      "Interlagos",         "BR", "2027-11-07", True,  "Interlagos"),
    (22, "United States", "Las Vegas Grand Prix",      "Las Vegas",          "US", "2027-11-20", False, "Las Vegas"),
    (23, "Qatar",         "Qatar Grand Prix",          "Lusail",             "QA", "2027-12-05", True,  "Lusail"),
    (24, "Abu Dhabi",     "Abu Dhabi Grand Prix",      "Yas Marina Circuit", "AE", "2027-12-12", True,  "Yas Marina Circuit"),
]

DRY = {"SOFT", "MEDIUM", "HARD"}


def _load(session_key: int, endpoint: str) -> list[dict]:
    path = RAW / str(session_key) / f"{endpoint}.json"
    return json.loads(path.read_text()) if path.exists() else []


def build_history(index: list[dict]) -> tuple[dict, dict, dict]:
    """Per-circuit strategy history, the current grid, and per-team pace offsets."""
    history: dict[str, list[dict]] = defaultdict(list)
    teams: dict[str, dict] = {}
    pace_samples: dict[str, list[float]] = defaultdict(list)

    for session in index:
        key = session["session_key"]
        circuit = session["circuit_short_name"]
        year = session["year"]

        laps = _load(key, "laps")
        stints = _load(key, "stints")
        pits = _load(key, "pit")
        drivers = {d["driver_number"]: d for d in _load(key, "drivers")}
        if not laps or not stints or not drivers:
            continue

        total_laps = max(l["lap_number"] for l in laps)

        laps_by_driver: dict[int, list[dict]] = defaultdict(list)
        for l in laps:
            if l.get("lap_duration"):
                laps_by_driver[l["driver_number"]].append(l)

        stints_by_driver: dict[int, list[dict]] = defaultdict(list)
        for s in stints:
            if s.get("lap_start") is None or s.get("lap_end") is None or not s.get("compound"):
                continue
            stints_by_driver[s["driver_number"]].append(s)

        stops_by_driver: dict[int, int] = defaultdict(int)
        for p in pits:
            stops_by_driver[p["driver_number"]] += 1

        # Classify by laps completed, then elapsed time — reproduces the finishing order
        # for everyone who saw the flag.
        ranking = []
        for dn, dl in laps_by_driver.items():
            ranking.append((dn, len(dl), sum(l["lap_duration"] for l in dl)))
        ranking.sort(key=lambda r: (-r[1], r[2]))
        position = {dn: i + 1 for i, (dn, _, _) in enumerate(ranking)}

        # Field-relative pace, so a team's pace offset is comparable across circuits.
        medians = {dn: float(np.median([l["lap_duration"] for l in dl])) for dn, dl in laps_by_driver.items() if len(dl) > 20}
        if not medians:
            continue
        field_median = float(np.median(list(medians.values())))

        entries = []
        for dn, plan in stints_by_driver.items():
            plan.sort(key=lambda s: s["stint_number"])
            meta = drivers.get(dn)
            if not meta:
                continue
            team = meta.get("team_name") or "Unknown"

            if year == 2026:
                teams.setdefault(team, {
                    "name": team,
                    "colour": f"#{meta['team_colour']}" if meta.get("team_colour") else "#8b949e",
                    "drivers": {},
                })
                teams[team]["drivers"][str(dn)] = {
                    "number": dn,
                    "name": meta.get("full_name") or f"Car {dn}",
                    "acronym": meta.get("name_acronym") or str(dn),
                    "headshot": meta.get("headshot_url"),
                }
                if dn in medians:
                    pace_samples[team].append(medians[dn] - field_median)

            compounds = [str(s["compound"]).upper() for s in plan]
            finished = plan[-1]["lap_end"] >= total_laps * 0.95
            entries.append({
                "driver": meta.get("full_name") or f"Car {dn}",
                "acronym": meta.get("name_acronym") or str(dn),
                "team": team,
                "position": position.get(dn),
                "finished": finished,
                "stops": stops_by_driver.get(dn, max(0, len(plan) - 1)),
                "compounds": compounds,
                "stintLaps": [s["lap_end"] - s["lap_start"] + 1 for s in plan],
                "pitLaps": [s["lap_end"] for s in plan[:-1]],
                "allDry": all(c in DRY for c in compounds),
            })

        if entries:
            entries.sort(key=lambda e: e["position"] or 99)
            history[circuit].append({
                "year": year,
                "totalLaps": total_laps,
                "entries": entries,
            })

    for records in history.values():
        records.sort(key=lambda r: -r["year"])

    team_pace = {
        team: round(float(np.median(vals)), 3)
        for team, vals in pace_samples.items()
        if len(vals) >= 4
    }
    return dict(history), teams, team_pace


def main() -> None:
    index = json.loads((RAW / "index.json").read_text())
    history, teams, team_pace = build_history(index)
    circuits = json.loads((OUT / "circuits.json").read_text())["circuits"]

    calendar = []
    for rnd, country, name, location, code, date, sprint, circuit_key in CALENDAR_2027:
        calendar.append({
            "round": rnd,
            "name": name,
            "shortName": name.replace(" Grand Prix", ""),
            "country": country,
            "countryCode": code,
            "location": location,
            "date": date,
            "sprint": sprint,
            "circuitKey": circuit_key,
            "hasModel": circuit_key is not None and circuit_key in circuits,
            "racesInHistory": len(history.get(circuit_key, [])) if circuit_key else 0,
        })

    for team in teams.values():
        team["drivers"] = sorted(team["drivers"].values(), key=lambda d: d["number"])
        team["paceOffset"] = team_pace.get(team["name"])

    payload = {
        "generatedAt": pd.Timestamp.now(tz="UTC").isoformat(),
        "season": 2027,
        "calendar": calendar,
        "teams": sorted(teams.values(), key=lambda t: (t["paceOffset"] if t["paceOffset"] is not None else 99)),
        "history": history,
    }
    dest = OUT / "context.json"
    dest.write_text(json.dumps(payload, indent=2))

    modelled = sum(1 for r in calendar if r["hasModel"])
    print(f"calendar: {len(calendar)} rounds, {modelled} with a fitted model")
    for r in calendar:
        if not r["hasModel"]:
            print(f"  NO MODEL: R{r['round']:>2} {r['name']} ({r['location']})")
    print(f"teams: {len(teams)}  drivers: {sum(len(t['drivers']) for t in teams.values())}")
    print(f"history: {len(history)} circuits, {sum(len(v) for v in history.values())} races")
    print(f"-> {dest} ({dest.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
