"""Draw a stratified sample of Europe PMC articles, pin it as a manifest, fetch and hash their JATS."""

import csv
import hashlib
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://www.ebi.ac.uk/europepmc/webservices/rest"
USER_AGENT = "credit-observatory (https://github.com/simonvanlierde/credit-matrix)"

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
# switch to the bulk OA files once the full run starts.
POOL = 1000


def _get(url: str, retries: int = 3) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404 or attempt == retries - 1:
                raise
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2**attempt)
    raise AssertionError("unreachable")


def search_ids(query: str, limit: int) -> list[str]:
    """PMCIDs of the first `limit` hits for a Europe PMC query."""
    ids: list[str] = []
    cursor = "*"
    while len(ids) < limit:
        params = {"query": query, "format": "json", "resultType": "idlist", "pageSize": "1000", "cursorMark": cursor}
        page = json.loads(_get(f"{API}/search?{urllib.parse.urlencode(params)}"))
        ids += [r["pmcid"] for r in page["resultList"]["result"] if r.get("pmcid")]
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


def write_manifest(rows: list[dict[str, str]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["pmcid", "stratum", "year"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def read_manifest(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def fetch(rows: list[dict[str, str]], xml_dir: Path, hashes_path: Path) -> dict[str, int]:
    """Download each article's JATS once, and check it against the pinned sha256 when one exists.

    Returns counts of fetched, cached, missing (404: no full text), failed (Europe PMC kept answering
    with a server error; a later run retries them) and changed (hash differs from the pin).
    """
    xml_dir.mkdir(parents=True, exist_ok=True)
    pinned = dict(line.split() for line in hashes_path.read_text().splitlines()) if hashes_path.exists() else {}
    counts = {"fetched": 0, "cached": 0, "missing": 0, "failed": 0, "changed": 0}
    for row in rows:
        pmcid = row["pmcid"]
        path = xml_dir / f"{pmcid}.xml"
        if path.exists():
            counts["cached"] += 1
        else:
            try:
                path.write_bytes(_get(f"{API}/{pmcid}/fullTextXML"))
            except urllib.error.HTTPError as error:
                counts["missing" if error.code == 404 else "failed"] += 1
                continue
            counts["fetched"] += 1
            time.sleep(0.1)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if pmcid in pinned and pinned[pmcid] != digest:
            counts["changed"] += 1
        pinned.setdefault(pmcid, digest)
    hashes_path.write_text("".join(f"{k} {v}\n" for k, v in sorted(pinned.items())))
    return counts
