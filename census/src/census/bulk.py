"""Read Europe PMC's open-access subset from its bulk files: every OA article, about 9,000 a file.

The files sit at ftp.ebi.ac.uk/pub/databases/pmc/oa/ as PMC<first>_PMC<last>.xml.gz, are replaced
weekly, and keep no old versions. They keep the role markup Europe PMC's REST API strips. A run
pins the listing it started from (file names and dates) and the sha256 of every file it read.
"""

import hashlib
import http.client
import re
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

from census.net import download, get
from census.rows import Rows, parse_file
from census.store import Unit

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
    the re-parse cache, about 168 GB in all), checks its sha256 against the pinned one when the listing
    has it, and parses its articles as they stream in."""

    name = "bulk"

    def __init__(self, files: list[dict[str, str]], cache: Path, base: str = BASE, download=download):
        self.listed = {f["unit"]: f.get("listed_date") for f in files}
        self.pinned = {f["unit"]: f.get("sha256") for f in files}
        self.cache, self.base, self.download = cache, base, download

    def units(self) -> list[str]:
        return list(self.listed)

    def read(self, unit: str) -> tuple[list[Rows], Unit]:
        record: Unit = {"unit": unit, "listed_date": self.listed[unit], "articles": 0, "retries": 0, "finished": False}
        path = self.cache / unit
        try:
            if not path.exists():
                self.cache.mkdir(parents=True, exist_ok=True)
                self.download(self.base + unit, path)
            with path.open("rb") as f:
                digest = hashlib.file_digest(f, "sha256").hexdigest()
            record |= {"size": path.stat().st_size, "sha256": digest}
            if (pinned := self.pinned.get(unit)) and digest != pinned:
                # Europe PMC replaced the file since the snapshot pinned it: reading it would mix content.
                return [], {**record, "error": f"sha256 {digest} is not the pinned {pinned}"}
            rows = parse_file(path, unit)
        except (OSError, EOFError, zlib.error, http.client.HTTPException) as error:
            # A failed download or a truncated file (BadGzipFile is an OSError): download it again next run.
            path.unlink(missing_ok=True)
            return [], {**record, "retries": 1, "error": f"{type(error).__name__}: {error}"}
        except ET.ParseError as error:
            # Malformed XML in a good download: keep the file. iterparse cannot go on past the error.
            return [], {**record, "error": f"ParseError: {error}"}
        return rows, {**record, "articles": len(rows), "finished": True}
