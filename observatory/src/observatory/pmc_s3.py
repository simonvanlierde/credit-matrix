"""Read JATS from the PMC Open Access Subset on AWS (bucket pmc-oa-opendata, no login needed).

Each article version has a folder, `PMC123.2/PMC123.2.xml`. The bucket's daily inventory of its
metadata files lists every version, so one inventory date pins which version a run read.
"""

import gzip
import json
import re
import urllib.error
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from itertools import islice
from pathlib import Path

import duckdb

from observatory.net import get
from observatory.store import Rows, failed_row, rows_for

BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com"
INVENTORY = "inventory-reports/pmc-oa-opendata/metadata"


def latest_inventory() -> str:
    """The date folder (e.g. 2026-10-12T01-00Z) of the newest inventory."""
    listing = get(f"{BUCKET}/?list-type=2&delimiter=/&prefix={INVENTORY}/").decode()
    dates = re.findall(rf"<Prefix>{INVENTORY}/(\d{{4}}-\d\d-\d\dT\d\d-\d\dZ)/</Prefix>", listing)
    if not dates:
        raise RuntimeError("no inventory found in the PMC bucket")
    return max(dates)


def load_versions(date: str, cache: Path) -> dict[str, int]:
    """Newest version of every article in the inventory of `date`, cached as Parquet (about 7 million rows)."""
    if not cache.exists():
        manifest = json.loads(get(f"{BUCKET}/{INVENTORY}/{date}/manifest.json"))
        urls = [f"{BUCKET}/{f['key']}" for f in manifest["files"]]
        cache.parent.mkdir(parents=True, exist_ok=True)
        with duckdb.connect() as con:
            con.execute("SET enable_progress_bar = false")
            con.execute(
                f"""COPY (
                    SELECT regexp_extract(key, '(PMC\\d+)\\.(\\d+)\\.json$', 1) AS pmcid,
                           max(CAST(regexp_extract(key, '(PMC\\d+)\\.(\\d+)\\.json$', 2) AS INTEGER)) AS version
                    FROM read_csv(?, header = false, columns = {{'bucket': 'VARCHAR', 'key': 'VARCHAR',
                                  'modified': 'VARCHAR', 'etag': 'VARCHAR'}})
                    WHERE key LIKE '%.json'
                    GROUP BY 1
                ) TO '{cache}' (FORMAT parquet)""",
                [urls],
            )
    with duckdb.connect() as con:
        return dict(con.execute("SELECT pmcid, version FROM read_parquet(?)", [str(cache)]).fetchall())


def xml_url(pmcid: str, version: int) -> str:
    return f"{BUCKET}/{pmcid}.{version}/{pmcid}.{version}.xml"


def cached(fetch: Callable[[str], bytes], cache: Path) -> Callable[[str], bytes]:
    """`fetch`, keeping a gzipped copy of each file in `cache` so a re-parse needs no download."""
    cache.mkdir(parents=True, exist_ok=True)

    def read(url: str) -> bytes:
        path = cache / (url.rsplit("/", 1)[1] + ".gz")
        if path.exists():
            return gzip.decompress(path.read_bytes())
        data = fetch(url)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(gzip.compress(data, compresslevel=6))
        tmp.rename(path)  # never leaves a half-written file under the real name
        return data

    return read


Download = tuple[str, str, int | None, bytes | None, tuple[str, str] | None]
"""pmcid, stratum, version, the XML, and (style, error) when there is none."""


def _download(pmcid: str, stratum: str, version: int | None, fetch: Callable[[str], bytes]) -> Download:
    if version is None:
        return pmcid, stratum, None, None, ("missing", "not in the PMC Open Access Subset")
    try:
        return pmcid, stratum, version, fetch(xml_url(pmcid, version)), None
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return pmcid, stratum, version, None, ("missing", "HTTP 404")
        return pmcid, stratum, version, None, ("retry", f"HTTP {error.code}")
    except OSError as error:
        return pmcid, stratum, version, None, ("retry", f"fetch failed: {error}")


def _parse(item: Download) -> Rows:
    pmcid, stratum, version, xml, failure = item
    if xml is None:
        style, error = failure or ("error", "no XML")
        return failed_row(pmcid, stratum, style, error, version)
    return rows_for(pmcid, stratum, xml, version)


def stream(
    rows: Iterable[dict[str, str]],
    versions: dict[str, int],
    workers: int = 32,
    fetch: Callable[[str], bytes] = get,
    processes: int | None = None,
) -> Iterator[Rows]:
    """Fetch and parse each manifest row's article; results in manifest order.

    Downloads run in `workers` threads and parsing in `processes` processes (default: one per CPU), so
    a re-parse from the cache is not held to one core. A failed download comes back with style "retry"
    for the caller to leave out, so a resumed run tries it again. Work is queued a batch at a time,
    because Executor.map would queue every row up front.
    """
    rows = iter(rows)
    with ThreadPoolExecutor(workers) as io, ProcessPoolExecutor(processes) as cpu:
        while batch := list(islice(rows, 2000)):
            downloads = io.map(lambda r: _download(r["pmcid"], r["stratum"], versions.get(r["pmcid"]), fetch), batch)
            yield from cpu.map(_parse, downloads, chunksize=32)
