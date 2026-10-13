"""Read Europe PMC's open-access subset from its bulk files: every OA article, about 9,000 a file.

The files sit at ftp.ebi.ac.uk/pub/databases/pmc/oa/ as PMC<first>_PMC<last>.xml.gz, are replaced
weekly, and keep no old versions. They keep the role markup Europe PMC's REST API strips. A run
pins the listing it started from (file names and dates) and the sha256 of every file it read.
"""

import gzip
import hashlib
import os
import re
import threading
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from census.net import get
from census.store import Rows, rows_for_element

BASE = "https://ftp.ebi.ac.uk/pub/databases/pmc/oa/"
_ENTRY_RE = re.compile(r'href="(PMC\d+_PMC\d+\.xml\.gz)".*?(\d{4}-\d\d-\d\d \d\d:\d\d)')


def list_files(base: str = BASE) -> list[dict[str, str]]:
    """Name and listed modification time of every bulk file, in PMCID order."""
    entries = _ENTRY_RE.findall(get(base).decode())
    if not entries:
        raise RuntimeError(f"no bulk files listed at {base}")
    return [
        {"unit": name, "listed_date": date} for name, date in sorted(entries, key=lambda e: int(e[0][3:].split("_")[0]))
    ]


class BulkSource:
    """One unit per bulk file. Reading a unit downloads the file once into `cache` (the downloads are
    the re-parse cache, about 168 GB in all), hashes it, and parses its articles as they stream in."""

    name = "bulk"

    def __init__(self, files: list[dict[str, str]], cache: Path, base: str = BASE, download=get):
        self.listed = {f["unit"]: f.get("listed_date") for f in files}
        self.cache, self.base, self.download = cache, base, download

    def units(self) -> list[str]:
        return list(self.listed)

    def _path(self, unit: str) -> Path:
        path = self.cache / unit
        if not path.exists():
            self.cache.mkdir(parents=True, exist_ok=True)
            data = self.download(self.base + unit)
            tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
            tmp.write_bytes(data)
            tmp.rename(path)  # an interrupted download never leaves a half file under the real name
        return path

    def read(self, unit: str) -> tuple[list[Rows], dict[str, Any]]:
        try:
            path = self._path(unit)
            rows = _parse_file(path, unit)
        except Exception as error:  # a failed download, or a truncated file: read the unit again later
            (self.cache / unit).unlink(missing_ok=True)
            return [], {
                "unit": unit,
                "listed_date": self.listed[unit],
                "articles": 0,
                "retries": 1,
                "finished": False,
                "error": repr(error),
            }
        with path.open("rb") as f:
            digest = hashlib.file_digest(f, "sha256").hexdigest()
        record = {"unit": unit, "listed_date": self.listed[unit], "size": path.stat().st_size, "sha256": digest}
        return rows, {**record, "articles": len(rows), "retries": 0, "finished": True}


def _parse_file(path: Path, unit: str) -> list[Rows]:
    rows = []
    with gzip.open(path) as stream:
        for _, element in ET.iterparse(stream, events=("end",)):
            if element.tag == "article":
                if (one := rows_for_element(element, "all", unit)) is not None:
                    rows.append(one)
                element.clear()  # the file holds about 9,000 articles; keep one in memory at a time
    return rows
