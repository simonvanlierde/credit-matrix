"""Read a source into the database, a unit at a time: resume, progress, and a stop on outages."""

import sys
import time
from collections import deque
from concurrent.futures import Executor, ProcessPoolExecutor
from pathlib import Path
from typing import Any, Protocol

from census import store

# Stop when this many units in a row came back with nearly every article still to retry: the network
# or the disk is down, and reading on would store nothing for hours.
OUTAGE_UNITS, OUTAGE_SHARE = 5, 0.95


class Source(Protocol):
    """Where articles come from. Implementations must pickle: units are read in worker processes.

    `read` returns the unit's rows and its record for the units table (unit, articles, retries,
    finished, and for a file its size and sha256). Reading a unit again replaces its rows, so a unit
    left unfinished by failed downloads is simply read again on the next run.
    """

    name: str

    def units(self) -> list[str]: ...

    def read(self, unit: str) -> tuple[list[store.Rows], dict[str, Any]]: ...


class _InProcess(Executor):
    """For tests and debugging: no worker processes."""

    def map(self, fn, *iterables, **_):
        return map(fn, *iterables, strict=True)


def _read(job: tuple[Source, str]) -> tuple[list[store.Rows], dict[str, Any]]:
    source, unit = job
    return source.read(unit)


def run(source: Source, db: Path, processes: int | None = None, limit: int | None = None) -> dict[str, int]:
    """Read every unfinished unit of `source` into `db`, or the first `limit` of them. `processes=0` reads
    in this process.

    Returns counts per style, plus "retry" (articles left for the next run) and "stopped".
    """
    with store.connect(db) as con:
        finished = {unit for (unit,) in con.execute("SELECT unit FROM units WHERE finished").fetchall()}
        pending = [unit for unit in source.units() if unit not in finished][:limit]
        counts: dict[str, int] = {}
        recent: deque[bool] = deque(maxlen=OUTAGE_UNITS)
        start, articles = time.monotonic(), 0
        pool = _InProcess() if processes == 0 else ProcessPoolExecutor(processes)
        with pool:
            # buffersize keeps only a few units' rows waiting in memory, not all of them.
            results = pool.map(_read, ((source, unit) for unit in pending), buffersize=2 * (processes or 8))
            for i, (rows, unit) in enumerate(results, 1):
                store.insert(con, rows, unit)
                for r in rows:
                    counts[r.style] = counts.get(r.style, 0) + 1
                retries = unit.get("retries") or 0
                counts["retry"] = counts.get("retry", 0) + retries
                articles += len(rows)
                recent.append(retries > 0 and retries >= OUTAGE_SHARE * (retries + len(rows)))
                rate = articles / (time.monotonic() - start)
                print(f"{i}/{len(pending)} units, {articles} articles, {rate:.0f} a second", file=sys.stderr)
                if len(recent) == OUTAGE_UNITS and all(recent):
                    print(f"stopped: the last {OUTAGE_UNITS} units could not be downloaded", file=sys.stderr)
                    counts["stopped"] = 1
                    pool.shutdown(cancel_futures=True)
                    break
    return {k: v for k, v in counts.items() if v}
