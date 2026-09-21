"""Throttled, resumable OpenF1 HTTP client.

OpenF1's free tier allows 3 requests/second and 30 requests/minute. Every response
is cached to disk so re-running the pipeline costs nothing, and a partial run can
always be resumed.
"""
from __future__ import annotations

import json
import time
from collections import deque
from pathlib import Path
from typing import Any

import requests

BASE = "https://api.openf1.org/v1"
RAW = Path(__file__).parent / "raw"

_PER_SECOND = 3
_PER_MINUTE = 30
_recent: deque[float] = deque()


def _throttle() -> None:
    """Block until issuing another request respects both rate limits."""
    while True:
        now = time.monotonic()
        while _recent and now - _recent[0] > 60.0:
            _recent.popleft()
        in_last_second = sum(1 for t in _recent if now - t < 1.0)
        if in_last_second < _PER_SECOND and len(_recent) < _PER_MINUTE:
            _recent.append(now)
            return
        time.sleep(0.25)


def fetch(endpoint: str, cache_key: str, **params: Any) -> list[dict]:
    """GET /v1/<endpoint>, memoised on disk under raw/<cache_key>.json."""
    path = RAW / f"{cache_key}.json"
    if path.exists():
        return json.loads(path.read_text())

    for attempt in range(6):
        _throttle()
        resp = requests.get(f"{BASE}/{endpoint}", params=params, timeout=60)
        if resp.status_code == 429:
            time.sleep(5 * (attempt + 1))
            continue
        if resp.status_code == 404:
            # OpenF1 returns 404 rather than [] when a session has no rows for an
            # endpoint (e.g. a race with no safety car has no race_control entries).
            body = []
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("[]")
            return body
        if resp.status_code >= 500:
            time.sleep(3 * (attempt + 1))
            continue
        resp.raise_for_status()
        body = resp.json()
        # OpenF1 signals an empty result set with an object, not an empty list.
        data = body if isinstance(body, list) else []
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
        return data

    raise RuntimeError(f"rate limited repeatedly on {endpoint} {params}")
