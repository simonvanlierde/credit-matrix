"""OpenAlex's per-author CRediT roles (CC0), fetched by DOI, to score beside the census's own readers.

`fetch` asks the works API for 50 DOIs a request and appends each answer to a JSON Lines cache, so a
rerun or a resumed run sends only the DOIs not yet asked. `write` maps OpenAlex's authorships to census
author positions by byline order into `openalex_assignments`, leaving out articles whose author count
differs from the census's.
"""

import datetime
import http.client
import json
import sys
import time
import urllib.error
import urllib.parse
from collections import Counter
from collections.abc import Iterable
from pathlib import Path

import duckdb

from census import net, store
from census.roles import ROLE_PATTERNS

API = "https://api.openalex.org/works"
BATCH = 50
PAUSE = 1.0
"""Seconds between requests."""

Work = tuple[int, list[tuple[int, str]]]
"""A work's author count and its (author position, role slug) pairs, positions in byline order."""


class Stopped(Exception):
    """OpenAlex throttled the run or a request failed after its retries; the cache keeps what came back."""


def normal(doi: str) -> str:
    return doi.strip().lower().removeprefix("https://doi.org/")


def askable(doi: str) -> bool:
    """A DOI the works filter can take: a comma or a bar would split the filter."""
    return doi.startswith("10.") and "," not in doi and "|" not in doi


def _work(w: dict) -> Work:
    authors = w.get("authorships") or []
    pairs = [
        (i, r["id"].rstrip("/").rsplit("/", 1)[-1])
        for i, a in enumerate(authors, 1)
        for r in a.get("contributor_roles") or []
    ]
    return len(authors), pairs


def cached(cache: Path) -> dict[str, tuple[int, str, Work | None]]:
    """DOI -> (cache line, fetch date, work, or None when OpenAlex has no work with that DOI)."""
    out: dict[str, tuple[int, str, Work | None]] = {}
    if not cache.exists():
        return out
    with cache.open(encoding="utf-8") as f:
        for n, line in enumerate(f):
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:  # the half line of a killed run: its DOIs are asked again
                continue
            works = {normal(w["doi"]): _work(w) for w in entry["results"] if w.get("doi")}
            for doi in entry["dois"]:
                out[doi] = (n, entry["fetched"], works.get(doi))
    return out


def fetch(dois: Iterable[str], cache: Path, key: str | None = None, pause: float = PAUSE) -> int:
    """Ask OpenAlex for each askable DOI the cache lacks; returns the requests sent. `key` goes into the
    query as `api_key` and never into a message. Raises Stopped on HTTP 429 or a failed request."""
    done = cached(cache)
    todo = sorted({d for d in map(normal, dois) if askable(d) and d not in done})
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists() and cache.stat().st_size:
        with cache.open("rb+") as f:
            f.seek(-1, 2)
            if f.read(1) != b"\n":
                f.write(b"\n")  # end a killed run's half line, so the next answer starts a line of its own
    sent = 0
    for start in range(0, len(todo), BATCH):
        batch = todo[start : start + BATCH]
        params = {"filter": "doi:" + "|".join(batch), "select": "id,doi,authorships", "per-page": BATCH}
        if key:
            params["api_key"] = key
        if sent:
            time.sleep(pause)
        try:
            body = json.loads(net.get(f"{API}?{urllib.parse.urlencode(params)}", give_up=frozenset({429})))
        except urllib.error.HTTPError as error:
            raise Stopped(f"OpenAlex answered HTTP {error.code} after {sent} requests") from None
        except (OSError, http.client.HTTPException, ValueError) as error:
            raise Stopped(f"an OpenAlex request failed after {sent} requests ({type(error).__name__})") from None
        sent += 1
        results = body["results"]
        # A DOI two works share can push the answer past one page: the DOIs not in it are asked again next run.
        if body["meta"]["count"] > len(results):
            batch = [d for d in batch if d in {normal(w["doi"]) for w in results if w.get("doi")}]
        line = {"fetched": datetime.date.today().isoformat(), "dois": batch, "results": results}
        with cache.open("a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        if sent % 100 == 0:
            print(f"{sent} of {-(-len(todo) // BATCH)} requests", file=sys.stderr, flush=True)
    return sent


TABLE = "CREATE TABLE IF NOT EXISTS openalex_assignments (pmcid VARCHAR, author_position INTEGER, role VARCHAR)"


def write(con: duckdb.DuckDBPyConnection, articles: dict[str, tuple[str | None, int]], cache: Path) -> Counter[str]:
    """Replace the `openalex_assignments` rows of `articles` (id -> (DOI, author count)) with OpenAlex's
    roles from `cache`, and record the oldest fetch date and the requests they came from in `meta`.
    Returns the counts of articles per outcome."""
    known = cached(cache)
    counts: Counter[str] = Counter()
    rows, lines, dates = [], set(), []
    for pmcid, (doi, n_authors) in articles.items():
        doi = doi and normal(doi)
        if not doi or not askable(doi):
            counts["no askable DOI"] += 1
            continue
        if doi not in known:
            counts["not asked yet"] += 1
            continue
        line, fetched, work = known[doi]
        lines.add(line)
        dates.append(fetched)
        if work is None:
            counts["not in OpenAlex"] += 1
        elif work[0] != n_authors:
            counts["author count differs"] += 1
        elif not work[1]:
            counts["no roles"] += 1
        else:
            counts["with roles"] += 1
            for position, slug in work[1]:
                if slug in ROLE_PATTERNS:
                    rows.append((pmcid, position, slug))
                else:
                    counts["pairs with a non-CRediT role (left out)"] += 1
    con.begin()
    try:
        con.execute(TABLE)
        con.execute("DELETE FROM openalex_assignments WHERE pmcid IN (SELECT unnest(?))", [list(articles)])
        store._insert(con, "openalex_assignments", store._ROLE_SCHEMA, rows)
        if dates:
            con.execute("INSERT OR REPLACE INTO meta VALUES ('openalex_roles_fetched', ?)", [min(dates)])
            con.execute("INSERT OR REPLACE INTO meta VALUES ('openalex_roles_requests', ?)", [str(len(lines))])
        con.commit()
    except BaseException:
        con.rollback()
        raise
    return counts
