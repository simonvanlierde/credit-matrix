"""OpenAlex's per-author CRediT roles (CC0), fetched by DOI, to score beside the census's own readers.

`fetch` asks the works API for 50 DOIs a request and appends what `write` needs of each answer (per
work: its DOI, author count and (position, role) pairs) to a JSON Lines cache, so a rerun or a resumed
run sends only the DOIs not yet asked. `write` maps OpenAlex's authorships to census
author positions by byline order into `openalex_assignments`, leaving out articles whose author count
differs from the census's.
"""

import datetime
import http.client
import json
import re
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
THROTTLES = 5
"""HTTP 429 answers in a row to wait out before stopping: Retry-After seconds, or 60 s doubling."""
SPLIT = frozenset({400, 414})
"""Statuses meaning the filter refused a DOI (bad syntax, URL too long): the batch is asked one DOI at a time."""

Work = tuple[int, list[tuple[int, str]]]
"""A work's author count and its (author position, role slug) pairs, positions in byline order."""


class Stopped(Exception):
    """OpenAlex throttled the run or a request failed after its retries; the cache keeps what came back."""


def normal(doi: str) -> str:
    return doi.strip().lower().removeprefix("https://doi.org/")


_VERSION_RE = re.compile(r"(?:\.\d{1,2}|/v\d+)$")


def unversioned(doi: str) -> str:
    """The DOI without a version suffix: ".3" (one or two digits, so "pone.0123456" keeps its id) or "/v2"."""
    return _VERSION_RE.sub("", doi)


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
    # errors="replace": a run killed inside a multibyte character leaves bytes that are not UTF-8.
    with cache.open(encoding="utf-8", errors="replace") as f:
        for n, line in enumerate(f):
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:  # the half line of a killed run: its DOIs are asked again
                continue
            works = {doi: (n, [tuple(p) for p in pairs]) for doi, n, pairs in entry["works"]}
            # OpenAlex can answer a DOI with another version's work (elife.89892 with elife.89892.3,
            # openreseurope.21078.1 with .2): an unmatched work counts when it is the only one with the
            # same base. On purpose, so a requested version may get a later one's roles.
            bases = Counter(unversioned(d) for d in works if d not in entry["dois"])
            other = {unversioned(d): w for d, w in works.items() if d not in entry["dois"]}
            for doi in entry["dois"]:
                work = works.get(doi)
                if work is None and bases[unversioned(doi)] == 1:
                    work = other[unversioned(doi)]
                out[doi] = (n, entry["fetched"], work)
    return out


def _retry_after(error: urllib.error.HTTPError, waited: int) -> float:
    try:
        return max(0.0, float(error.headers.get("Retry-After", "")))
    except AttributeError, ValueError:  # no headers, or an HTTP date
        return 60.0 * 2**waited


def fetch(dois: Iterable[str], cache: Path, key: str | None = None, pause: float = PAUSE) -> int:
    """Ask OpenAlex for each askable DOI the cache lacks; returns the requests sent. `key` goes into the
    query as `api_key` and never into a message. HTTP 429 is waited out THROTTLES times in a row,
    unless it says the daily budget is spent; a batch
    refused with 400 or 414 is asked one DOI at a time, and a lone DOI still refused is recorded as not in
    OpenAlex. Raises Stopped past the throttles, on any other 4xx, a failed request or an answer of
    another shape, before anything of that request is written."""
    done = cached(cache)
    todo = sorted({d for d in map(normal, dois) if askable(d) and d not in done})
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists() and cache.stat().st_size:
        with cache.open("rb+") as f:
            f.seek(-1, 2)
            if f.read(1) != b"\n":
                f.write(b"\n")  # end a killed run's half line, so the next answer starts a line of its own
    sent = throttled = 0
    began = time.monotonic()
    batches = [todo[start : start + BATCH] for start in range(0, len(todo), BATCH)]
    while batches:
        batch = batches.pop(0)
        params = {"filter": "doi:" + "|".join(batch), "select": "id,doi,authorships", "per-page": BATCH}
        if key:
            params["api_key"] = key
        if sent:
            time.sleep(pause)
        sent += 1
        try:
            body = json.loads(net.get(f"{API}?{urllib.parse.urlencode(params)}", give_up=frozenset({429})))
            works = [(normal(w["doi"]), *_work(w)) for w in body["results"] if w.get("doi")]
            # A DOI two works share can push the answer past one page: the DOIs not on it are asked again next run.
            if body["meta"]["count"] > len(body["results"]):
                back = {unversioned(doi) for doi, _, _ in works}
                batch = [d for d in batch if unversioned(d) in back]
        except urllib.error.HTTPError as error:
            headers = error.headers or {}
            if error.code == 429 and headers.get("X-RateLimit-Remaining") == "0":
                # The daily budget is spent (keyless: 1,000 requests a day per IP); waiting minutes will not help.
                reset = headers.get("X-RateLimit-Reset", "?")
                raise Stopped(
                    f"OpenAlex's daily budget is spent after {sent} requests; it resets in {reset} s"
                ) from None
            if error.code == 429 and throttled < THROTTLES:
                time.sleep(_retry_after(error, throttled))
                throttled += 1
                batches.insert(0, batch)
                continue
            if error.code not in SPLIT:
                raise Stopped(f"OpenAlex answered HTTP {error.code} after {sent} requests") from None
            # A DOI the filter refuses would stop every rerun at this batch: ask its DOIs one at a
            # time, and record a lone DOI that is still refused as not in OpenAlex.
            if len(batch) > 1:
                batches[:0] = [[d] for d in batch]
                continue
            works = []
        except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError, AttributeError) as error:
            raise Stopped(f"an OpenAlex request failed after {sent} requests ({type(error).__name__})") from None
        throttled = 0
        line = {"fetched": datetime.date.today().isoformat(), "dois": batch, "works": works}
        with cache.open("a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        if sent % 100 == 0:
            left = sum(map(len, batches))
            hours = (time.monotonic() - began) / sent * -(-left // BATCH) / 3600  # at this run's pace, waits included
            print(
                f"{sent} requests sent, {left} of {len(todo)} DOIs left, about {hours:.1f} h to go",
                file=sys.stderr,
                flush=True,
            )
    return sent


TABLE = "CREATE TABLE IF NOT EXISTS openalex_assignments (pmcid VARCHAR, author_position INTEGER, role VARCHAR)"


def write(con: duckdb.DuckDBPyConnection, articles: dict[str, tuple[str | None, int]], cache: Path) -> Counter[str]:
    """Replace the `openalex_assignments` rows of `articles` (id -> (DOI, author count)) with OpenAlex's
    roles from `cache`. The `meta` keys `openalex_roles_fetched` and `openalex_roles_requests` describe
    this write only: the oldest fetch date and the cache lines of `articles`, though the table keeps the
    rows of earlier writes. Returns the counts of articles per outcome."""
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
