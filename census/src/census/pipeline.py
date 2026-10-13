"""Run a manifest through a reader into the database: resume, batch, report progress, stop on outages."""

import sys
import time
from collections import deque
from collections.abc import Callable
from pathlib import Path

from census import pmc_s3, store
from census.net import get

BATCH = 1000
# Stop when nearly every recent download failed: the network or the disk is down, and churning
# through millions of rows at several seconds of backoff each would store nothing for hours.
OUTAGE_WINDOW, OUTAGE_SHARE = 1000, 0.95


def run(
    manifest: list[dict[str, str]],
    versions: dict[str, int],
    db: Path,
    workers: int,
    fetch: Callable[[str], bytes] = get,
    processes: int | None = None,
) -> dict[str, int]:
    """Stream the manifest's articles from the PMC bucket into `db`, skipping those already there.

    Returns counts per style; "retry" rows are not stored, so the next run tries them again.
    """
    with store.connect(db) as con:
        finished = store.done(con)
        todo = [row for row in manifest if row["pmcid"] not in finished]
        counts: dict[str, int] = {}
        batch: list[store.Rows] = []
        recent: deque[bool] = deque(maxlen=OUTAGE_WINDOW)
        start = time.monotonic()
        for i, rows in enumerate(pmc_s3.stream(todo, versions, workers, fetch, processes), 1):
            counts[rows.style] = counts.get(rows.style, 0) + 1
            recent.append(rows.style == "retry")
            if rows.style != "retry":
                batch.append(rows)
            if len(batch) >= BATCH or i == len(todo):
                store.insert(con, batch)
                batch = []
            if i % BATCH == 0 or i == len(todo):
                rate = i / (time.monotonic() - start)
                print(f"{i}/{len(todo)} done, {rate:.0f} a second, {counts.get('retry', 0)} to retry", file=sys.stderr)
            if len(recent) == OUTAGE_WINDOW and sum(recent) >= OUTAGE_SHARE * OUTAGE_WINDOW:
                store.insert(con, batch)
                print(f"stopped: {sum(recent)} of the last {OUTAGE_WINDOW} downloads failed", file=sys.stderr)
                counts["stopped"] = 1
                break
    return counts
