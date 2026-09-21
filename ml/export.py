"""Copy the fitted artefacts into the web app's bundle.

Kept as an explicit step so a refit never silently changes what the app ships: you
run it, you see the diff, you commit it.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

OUT = Path(__file__).parent / "out"
WEB_MODELS = Path(__file__).parent.parent / "web" / "src" / "models"

ARTEFACTS = ("circuits.json", "backtest.json", "context.json")


def main() -> None:
    WEB_MODELS.mkdir(parents=True, exist_ok=True)
    for name in ARTEFACTS:
        src = OUT / name
        if not src.exists():
            raise SystemExit(f"missing {src} — run clean.py, fit.py and backtest.py first")
        shutil.copy2(src, WEB_MODELS / name)
        size = (WEB_MODELS / name).stat().st_size
        print(f"{name:<16} {size / 1024:>7.1f} KB -> {WEB_MODELS / name}")

    circuits = json.loads((OUT / "circuits.json").read_text())
    print(f"\n{len(circuits['circuits'])} circuits, {circuits['usableLaps']:,} laps, "
          f"seasons {circuits['seasons']}")


if __name__ == "__main__":
    main()
