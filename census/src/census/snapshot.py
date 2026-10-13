"""Draw a stratified sample of articles from Europe PMC's search and pin it as a manifest."""

import csv
import gzip
import json
import random
import re
import urllib.parse
from pathlib import Path

from census.net import get

API = "https://www.ebi.ac.uk/europepmc/webservices/rest"
PMCID_RE = re.compile(r"PMC\d+")

# Publishers with the most CRediT statements in Europe PMC, by markup style (counts in the README).
STRATA = {
    "plos": 'PUBLISHER:"Public Library of Science"',
    "frontiers": 'PUBLISHER:"Frontiers Media SA"',
    "mdpi": 'PUBLISHER:"MDPI"',
    "elsevier": 'PUBLISHER:"Elsevier"',
    "nature": 'PUBLISHER:"Nature Publishing Group"',
    "springer": 'PUBLISHER:"Springer"',
    "bmj": 'PUBLISHER:"BMJ Publishing Group"',
    "elife": 'PUBLISHER:"eLife Sciences Publications Ltd"',
}
YEARS = range(2020, 2026)
# shortcut: samples from the first POOL hits in Europe PMC's default order, not the whole stratum;
# the full run reads every article from the bulk files instead.
POOL = 1000


def search_ids(query: str, limit: int) -> list[str]:
    """PMCIDs of the first `limit` hits for a Europe PMC query."""
    ids: list[str] = []
    cursor = "*"
    while len(ids) < limit:
        params = {"query": query, "format": "json", "resultType": "idlist", "pageSize": "1000", "cursorMark": cursor}
        page = json.loads(get(f"{API}/search?{urllib.parse.urlencode(params)}"))
        # Only well-formed PMCIDs: they become file names later.
        ids += [r["pmcid"] for r in page["resultList"]["result"] if PMCID_RE.fullmatch(r.get("pmcid") or "")]
        if not page["resultList"]["result"] or page.get("nextCursorMark") in (None, cursor):
            break
        cursor = page["nextCursorMark"]
    return ids[:limit]


def draw(per_cell: int, seed: int) -> list[dict[str, str]]:
    """`per_cell` articles for each publisher and year, drawn with a fixed seed."""
    rng = random.Random(seed)
    rows = []
    for stratum, query in STRATA.items():
        for year in YEARS:
            q = f"({query}) AND OPEN_ACCESS:y AND IN_EPMC:y AND PUB_YEAR:{year}"
            pool = sorted(search_ids(q, POOL))
            for pmcid in rng.sample(pool, min(per_cell, len(pool))):
                rows.append({"pmcid": pmcid, "stratum": stratum, "year": str(year)})
    return rows


def _open(path: Path, mode: str):
    return gzip.open(path, mode + "t", newline="") if path.suffix == ".gz" else path.open(mode, newline="")


def write_manifest(rows: list[dict[str, str]], path: Path) -> None:
    """A CSV of pmcid, stratum, year; gzipped when `path` ends in .gz."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with _open(path, "w") as f:
        writer = csv.DictWriter(f, fieldnames=["pmcid", "stratum", "year"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def read_manifest(path: Path) -> list[dict[str, str]]:
    with _open(path, "r") as f:
        rows = list(csv.DictReader(f))
    if bad := [r["pmcid"] for r in rows if not PMCID_RE.fullmatch(r["pmcid"])]:
        raise ValueError(f"{path}: not PMCIDs: {', '.join(bad[:5])}")
    return rows
