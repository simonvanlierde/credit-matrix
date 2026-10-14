"""Read JATS from the PMC Open Access Subset on AWS (bucket pmc-oa-opendata, no login needed).

Each article version has a folder, `PMC123.2/PMC123.2.xml`. The bucket's daily inventory of its
metadata files lists every version, so one inventory date pins which version a run read.
"""

import gzip
import json
import re
import urllib.error
import zlib
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb

from census.net import get, replacing
from census.rows import Rows, failed_row, rows_for
from census.store import Unit

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
        with replacing(cache) as tmp, duckdb.connect() as con:
            con.execute("SET enable_progress_bar = false")
            con.execute(
                f"""COPY (
                    SELECT regexp_extract(key, '(PMC\\d+)\\.(\\d+)\\.json$', 1) AS pmcid,
                           max(CAST(regexp_extract(key, '(PMC\\d+)\\.(\\d+)\\.json$', 2) AS INTEGER)) AS version
                    FROM read_csv(?, header = false, columns = {{'bucket': 'VARCHAR', 'key': 'VARCHAR',
                                  'modified': 'VARCHAR', 'etag': 'VARCHAR'}})
                    WHERE key LIKE '%.json'
                    GROUP BY 1
                ) TO '{tmp}' (FORMAT parquet)""",
                [urls],
            )
    with duckdb.connect() as con:
        return dict(con.execute("SELECT pmcid, version FROM read_parquet(?)", [str(cache)]).fetchall())


def xml_url(pmcid: str, version: int) -> str:
    return f"{BUCKET}/{pmcid}.{version}/{pmcid}.{version}.xml"


class CachedFetch:
    """`fetch`, keeping a gzipped copy of each file in `cache` so a re-parse needs no download.

    A class, not a closure, so a source holding it can be sent to worker processes.
    """

    def __init__(self, cache: Path, fetch: Callable[[str], bytes] = get):
        self.cache, self.fetch = cache, fetch

    def __call__(self, url: str) -> bytes:
        self.cache.mkdir(parents=True, exist_ok=True)
        path = self.cache / (url.rsplit("/", 1)[1] + ".gz")
        if path.exists():
            try:
                data = gzip.decompress(path.read_bytes())
                if data:
                    return data
            except OSError, EOFError, zlib.error:
                pass
            path.unlink(missing_ok=True)  # truncated, empty or not gzip: fetch it again
        data = self.fetch(url)
        with replacing(path) as tmp:
            tmp.write_bytes(gzip.compress(data, compresslevel=6))
        return data


def _one(pmcid: str, stratum: str, version: int | None, fetch: Callable[[str], bytes]) -> Rows:
    if version is None:
        return failed_row(pmcid, stratum, "missing", "not in the PMC Open Access Subset")
    try:
        xml = fetch(xml_url(pmcid, version))
    except urllib.error.HTTPError as error:
        style = "missing" if error.code == 404 else "retry"
        return failed_row(pmcid, stratum, style, f"HTTP {error.code}", version)
    except Exception as error:  # IncompleteRead and other http.client errors are not OSErrors
        return failed_row(pmcid, stratum, "retry", f"fetch failed: {type(error).__name__}: {error}", version)
    return rows_for(pmcid, stratum, xml, version)


class BucketSource:
    """Articles listed in a manifest, one request each, from the PMC bucket: for samples.

    Units are chunks of `chunk` manifest rows, each downloaded by `workers` threads in one process.
    An article whose download failed comes back with style "retry" and keeps its unit unfinished.
    """

    name = "bucket"

    def __init__(
        self,
        manifest: list[dict[str, str]],
        versions: dict[str, int],
        fetch: Callable[[str], bytes],
        workers: int = 16,
        chunk: int = 200,
    ):
        # Only the manifest's versions: the whole inventory (about 9 million) would go to every process.
        self.versions = {r["pmcid"]: versions[r["pmcid"]] for r in manifest if r["pmcid"] in versions}
        self.chunks = {f"bucket-{i // chunk:05d}": manifest[i : i + chunk] for i in range(0, len(manifest), chunk)}
        self.fetch, self.workers = fetch, workers

    def units(self) -> list[str]:
        return list(self.chunks)

    def read(self, unit: str) -> tuple[list[Rows], Unit]:
        rows = self.chunks[unit]
        with ThreadPoolExecutor(self.workers) as pool:
            results = list(
                pool.map(lambda r: _one(r["pmcid"], r["stratum"], self.versions.get(r["pmcid"]), self.fetch), rows)
            )
        failed = [r for r in results if r.style == "retry"]
        stored = [r for r in results if r.style != "retry"]
        record: Unit = {"unit": unit, "articles": len(stored), "retries": len(failed), "finished": not failed}
        if failed:
            record["error"] = f"{len(failed)} downloads failed, e.g. {failed[0].article['error']}"
        return stored, record
