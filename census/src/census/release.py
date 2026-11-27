"""The public export as a sourceledger release: the Europe PMC files behind it, hashed, and nothing restricted.

Each bulk file the database read is a restricted source (its articles carry mixed licences), recorded
with its sha256 but left out of the release. The export's own files are the redistributable sources.
sourceledger is the optional `release` dependency group.
"""

import csv
import hashlib
import shutil
from pathlib import Path

import duckdb

from census import export
from census.bulk import BASE

REPO = "https://github.com/simonvanlierde/credit-matrix"
INPUTS = "inputs.csv"
"""The bulk files' names, sizes and sha256, shipped so a recipient can check their own copies."""
PREFIX = "bulk-"
# The statements keep each article's own licence: CC BY of any version, or CC0 (export.OPEN_LICENCE).
CC_BY_MIXED = "CC-BY-4.0 AND CC-BY-3.0 AND CC-BY-2.0 AND CC0-1.0"
OUTPUTS = {
    "articles": ("articles.parquet", "CC0-1.0", "CC0 1.0"),
    "assignments": ("assignments.parquet", "CC0-1.0", "CC0 1.0"),
    "statements": ("statements.parquet", CC_BY_MIXED, "CC BY 4.0, each row keeps its article's licence"),
    "meta": ("meta.json", "CC0-1.0", "CC0 1.0"),
    "readme": ("README.md", "CC0-1.0", "CC0 1.0"),
    "inputs": (INPUTS, "CC0-1.0", "CC0 1.0"),
    "attribution": ("ATTRIBUTION.md", "CC0-1.0", "CC0 1.0"),
}


def _sourceledger():
    try:
        import sourceledger
    except ImportError:
        raise ImportError("census release needs sourceledger: `uv sync --group release`") from None
    return sourceledger


def release(
    con: duckdb.DuckDBPyConnection, out: Path, name: str, cache: Path, work: Path, partial: bool = False
) -> dict[str, int]:
    """Write the sourceledger release folder `out` and return the export's row counts.

    `cache` holds the bulk files, `work` the sourceledger project (its raw copies and fetch log). Raises
    ValueError for a unit whose file is missing from `cache`, or whose hash no longer matches the database.
    """
    sl = _sourceledger()
    work.mkdir(parents=True, exist_ok=True)
    stage = work / "export"
    shutil.rmtree(stage, ignore_errors=True)
    counts = export.export(con, stage, name, partial=partial)
    units = con.execute(
        "SELECT unit, size, sha256 FROM units WHERE finished AND sha256 IS NOT NULL ORDER BY unit"
    ).fetchall()
    if not units:
        raise ValueError("no finished unit with a sha256 in the database: nothing to list in inputs.csv")
    listed = {unit for (unit, _, _) in units}
    articles = stage / "articles.parquet"
    exported = {
        r[0]
        for r in con.execute(f"SELECT DISTINCT source_unit FROM '{articles}' WHERE source_unit IS NOT NULL").fetchall()
    }
    if missing := sorted(exported - listed):
        raise ValueError(f"articles come from {', '.join(missing)}, which has no finished unit with a sha256")
    with (stage / INPUTS).open("w", newline="") as fh:
        csv.writer(fh, lineterminator="\n").writerows([("unit", "bytes", "sha256"), *units])
    generic = {**_input("x.xml.gz", name), "name": "Europe PMC open-access bulk files, listed in inputs.csv"}
    inputs = [_input(unit, name) for (unit, _, _) in units]
    outputs = [_output(key, name) for key in OUTPUTS]
    (stage / "ATTRIBUTION.md").write_text(
        "# Sources\n\nThe Europe PMC files the dataset was read from carry mixed licences and are not"
        " republished; their hashes are in inputs.csv.\n\n"
        + "\n".join(sl.attribution([generic]))
        + "\n\nThe files of this dataset:\n\n"
        + "\n".join(sl.attribution(outputs))
        + "\n"
    )
    raw, processed, log = work / "data" / "raw", work / "data" / "processed", work / "data" / "fetches.jsonl"
    for source, (unit, _, digest) in zip(inputs, units, strict=True):
        path = cache / unit
        if not path.is_file():
            raise ValueError(f"{unit} is not in {cache}")
        record = sl.record(source, path, raw=raw, log=log)
        if record.sha256 != digest:
            raise ValueError(f"{unit} hashes to {record.sha256}, not the {digest} in the database")
    for source in outputs:
        sl.record(source, stage / Path(source["url"]).name, raw=raw, log=log)
    sources = inputs + outputs
    # NOTE: build copies every bulk file once more into processed/, because release validates the excluded
    # sources too. Fine for a small snapshot, a gap for 169 GB (see the sourceledger gaps note).
    sl.build(sources, raw=raw, processed=processed, name=name)
    sl.release(sources, out, raw=raw, processed=processed, name=name)
    return counts


def _input(unit: str, snapshot: str) -> dict:
    return {
        "id": PREFIX + unit.removesuffix(".xml.gz"),
        "name": f"Europe PMC bulk file {unit}",
        "status": "implemented",
        "url": BASE + unit,
        "vintage": snapshot,
        "terms": "Open-access subset: each article keeps its own licence, many allow no redistribution of the text",
        "terms_url": "https://europepmc.org/downloads/openaccess",
        "license": "LicenseRef-EuropePMC-OA-mixed",
        "redistribute": False,
        "format": "file",
        "max_bytes": 2**31,
    }


def _output(key: str, snapshot: str) -> dict:
    file, licence, terms = OUTPUTS[key]
    return {
        "id": key,
        "name": f"CRediT census {file}",
        "status": "implemented",
        # NOTE: sourceledger wants a URL per source and names the release file from its path's extension, so
        # the path must end in the real file name. No GitHub page resolves that way, so this link is a label.
        "url": f"{REPO}/tree/main/census/{snapshot}/{file}",
        "vintage": snapshot,
        "terms": terms,
        "terms_url": "https://creativecommons.org/publicdomain/zero/1.0/"
        if licence == "CC0-1.0"
        else "https://creativecommons.org/licenses/by/4.0/",
        "license": licence,
        "redistribute": True,
        "format": "file",
    }


def verify(out: Path, cache: Path) -> list[str]:
    """Problems with a release folder: its files against datapackage.json, then each bulk file in `cache`
    against the sha256 in the release's inputs.csv."""
    sl = _sourceledger()
    problems = sl.verify(out)
    try:
        problems += sl.check_release(out)[0]  # SHA256SUMS and the metadata files: catches a stray file
    except (sl.ValidatorMissing, sl.ValidatorCouldNotRun) as error:
        problems.append(f"release not fully checked: {error}")
    with (out / "data" / INPUTS).open(newline="") as fh:
        for row in csv.DictReader(fh):
            path = cache / row["unit"]
            if not path.is_file():
                problems.append(f"{row['unit']}: not in {cache}")
            elif (digest := _sha256(path)) != row["sha256"]:
                problems.append(f"{row['unit']}: input changed, sha256 {digest}, release says {row['sha256']}")
    return problems


def _sha256(path: Path) -> str:
    with path.open("rb") as fh:
        return hashlib.file_digest(fh, "sha256").hexdigest()
