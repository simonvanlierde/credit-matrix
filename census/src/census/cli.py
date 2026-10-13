"""How published papers use CRediT roles; see the README in census/."""

import argparse
import csv
import re
import sys
from pathlib import Path

import duckdb

from census import bulk, export, fields, labels, pipeline, pmc_s3, snapshot, store
from census.reports import REPORTS

ROOT = Path(__file__).resolve().parents[2]  # census/, so commands work from any directory
SNAPSHOTS = ROOT / "snapshots"
DATA = ROOT / "data"
INVENTORY_RE = re.compile(r"\d{4}-\d\d-\d\dT\d\d-\d\dZ")


class Failure(Exception):
    """A mistake the user can fix: printed as one line, exit code 1."""


def _manifest(name: str) -> Path:
    path = SNAPSHOTS / f"{name}.csv"
    if not path.exists():
        known = ", ".join(sorted(p.stem for p in SNAPSHOTS.glob("*.csv"))) or "none"
        raise Failure(f"no manifest {path}; known snapshots: {known}")
    return path


def _db(args: argparse.Namespace, must_exist: bool = True) -> Path:
    db: Path = args.db or DATA / f"{args.snapshot}.duckdb"
    if must_exist and not db.exists():
        raise Failure(f"no database {db}; build it with `census run --snapshot {args.snapshot}`")
    return db


def cmd_snapshot(args: argparse.Namespace) -> None:
    path = SNAPSHOTS / f"{args.snapshot}.csv"
    if path.exists():
        raise Failure(f"{path} exists; a pinned snapshot is never redrawn. Pick a new --snapshot name.")
    rows = snapshot.draw(args.per_cell, args.seed)
    snapshot.write_manifest(rows, path)
    print(f"{len(rows)} articles in {path}")


def cmd_run(args: argparse.Namespace) -> None:
    try:
        manifest = snapshot.read_manifest(_manifest(args.snapshot))
    except ValueError as error:
        raise Failure(error) from error
    if args.inventory not in (None, "latest") and not INVENTORY_RE.fullmatch(args.inventory):
        raise Failure(f"--inventory {args.inventory!r} is not a date like 2026-10-12T01-00Z or 'latest'")
    db = _open_db(args, "bucket")
    pin_file = SNAPSHOTS / f"{args.snapshot}.inventory"
    committed = pin_file.read_text().strip() if pin_file.exists() else None
    with store.connect(db) as con:
        (used,) = con.execute("SELECT value FROM meta WHERE key = 'inventory'").fetchone() or (None,)
        # The committed pin wins over the newest inventory, so a clean clone reproduces the sample.
        date = pmc_s3.latest_inventory() if args.inventory == "latest" else args.inventory or used or committed
        date = date or pmc_s3.latest_inventory()
        if store.pin(con, "inventory", date) != date:
            raise Failure(f"{db} was read from inventory {used}; use --fresh or another --db to read {date}")
    versions = pmc_s3.load_versions(date, DATA / f"pmc-inventory-{date}.parquet")
    source = pmc_s3.BucketSource(manifest, versions, pmc_s3.CachedFetch(args.xml_cache), args.workers)
    counts = pipeline.run(source, db, args.processes)
    if committed is None and "stopped" not in counts:
        pin_file.write_text(date + "\n")
    print(f"inventory {date}: " + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())))


def _open_db(args: argparse.Namespace, source: str) -> Path:
    """The run's database, after --fresh and the parser, schema and source pins are checked."""
    db = _db(args, must_exist=False)
    if args.fresh:
        db.unlink(missing_ok=True)
    with store.connect(db) as con:
        mismatches = store.mismatched_pins(con)
        if (pinned := store.pin(con, "source", source)) != source:
            mismatches.append(f"source {pinned} (this run: {source})")
        if mismatches:
            raise Failure(f"{db} was built by other code ({'; '.join(mismatches)}); rerun with --fresh")
    return db


def cmd_bulk(args: argparse.Namespace) -> None:
    db = _open_db(args, "bulk")
    pin_file = SNAPSHOTS / f"{args.snapshot}.files.csv"
    if pin_file.exists():
        with pin_file.open(newline="") as f:
            files = list(csv.DictReader(f))
    else:
        # The listing this snapshot reads, committed before any download: the weekly refresh can
        # replace files, and the hashes written at the end show which content was read.
        files = bulk.list_files()
        _write_files(pin_file, files)
    source = bulk.BulkSource(files, args.cache)
    counts = pipeline.run(source, db, args.processes, args.limit)
    with duckdb.connect(str(db), read_only=True) as con:
        hashes = dict(con.execute("SELECT unit, sha256 FROM units WHERE finished").fetchall())
    _write_files(pin_file, [{**f, "sha256": hashes.get(f["unit"], f.get("sha256", ""))} for f in files])
    print(f"{len(hashes)}/{len(files)} files read: " + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())))


def _write_files(path: Path, files: list[dict[str, str]]) -> None:
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["unit", "listed_date", "sha256"], lineterminator="\n", extrasaction="ignore"
        )
        writer.writeheader()
        writer.writerows({"sha256": "", **row} for row in files)


def cmd_fields(args: argparse.Namespace) -> None:
    with store.connect(_db(args)) as con:
        print(f"{fields.build_journals(con, args.sources)} journals with a field")


def cmd_report(args: argparse.Namespace) -> None:
    with duckdb.connect(str(_db(args)), read_only=True) as con:
        (has_fields,) = con.execute(
            "SELECT count(*) FROM duckdb_views() WHERE view_name = 'article_fields'"
        ).fetchone() or (0,)
        for title, query in REPORTS.items():
            if "article_fields" in query and not has_fields:
                print(f"\n{title}: run `census fields` first")
                continue
            print(f"\n{title}")
            con.sql(query).show(max_rows=60, max_width=200)


def cmd_export(args: argparse.Namespace) -> None:
    out = args.out or DATA / "export" / args.snapshot
    with duckdb.connect(str(_db(args)), read_only=True) as con:
        counts = export.export(con, out, args.snapshot)
    print(f"{out}: " + ", ".join(f"{v} {k}" for k, v in counts.items()))


def cmd_label(args: argparse.Namespace) -> None:
    out = args.out or DATA / "labels" / f"{args.snapshot}.csv"
    with duckdb.connect(str(_db(args)), read_only=True) as con:
        print(f"{labels.export(con, out, args.per_style, args.seed)} articles to label in {out}")


def cmd_score(args: argparse.Namespace) -> None:
    with duckdb.connect(str(_db(args)), read_only=True) as con:
        try:
            results = labels.score(con, args.labels)
        except ValueError as error:
            raise Failure(error) from error
    print(f"{'style':<16}{'articles':>9}{'precision':>11}{'recall':>8}{'f1':>7}{'exact':>7}")
    for style, n, p, r, f1, exact in results:
        print(f"{style:<16}{n:>9}{p:>11}{r:>8}{f1:>7}{exact:>7}")


def main(argv: list[str] | None = None) -> int:
    snap = argparse.ArgumentParser(add_help=False)
    snap.add_argument("--snapshot", default="sample-2026-10", help="manifest name in census/snapshots/")
    db = argparse.ArgumentParser(add_help=False)
    db.add_argument("--db", type=Path, help="database (default: census/data/<snapshot>.duckdb)")
    parser = argparse.ArgumentParser(prog="census", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    cmd = sub.add_parser("snapshot", parents=[snap], help="draw a stratified sample from Europe PMC")
    cmd.add_argument("--per-cell", type=int, default=15, help="articles per publisher and year")
    cmd.add_argument("--seed", type=int, default=20261013, help="seed for the draw")
    cmd.set_defaults(func=cmd_snapshot)
    cmd = sub.add_parser("run", parents=[snap, db], help="read the manifest from the PMC bucket into the database")
    cmd.add_argument("--inventory", help="bucket inventory date, or 'latest' (default: the snapshot's pin)")
    cmd.add_argument("--workers", type=int, default=16, help="parallel downloads in each process")
    cmd.add_argument("--processes", type=int, default=8, help="worker processes (0: none)")
    cmd.add_argument("--fresh", action="store_true", help="delete the database first (cached XML is reused)")
    cmd.add_argument("--xml-cache", type=Path, default=DATA / "xml-cache", help="gzipped XML kept for re-parsing")
    cmd.set_defaults(func=cmd_run)
    cmd = sub.add_parser("bulk", parents=[db], help="read every open-access article from Europe PMC's bulk files")
    cmd.add_argument("--snapshot", default="oa-2026-10", help="name of the file listing in census/snapshots/")
    cmd.add_argument("--processes", type=int, default=16, help="files downloaded and parsed at once (0: none)")
    cmd.add_argument("--fresh", action="store_true", help="delete the database first (downloaded files are reused)")
    cmd.add_argument("--cache", type=Path, default=DATA / "bulk", help="where the bulk files are kept (about 168 GB)")
    cmd.add_argument("--limit", type=int, help="read at most this many unread files, to try a run")
    cmd.set_defaults(func=cmd_bulk)
    cmd = sub.add_parser("fields", parents=[snap, db], help="add journal fields from OpenAlex")
    cmd.add_argument("--sources", default=fields.OPENALEX_SOURCES, help="OpenAlex sources Parquet")
    cmd.set_defaults(func=cmd_fields)
    cmd = sub.add_parser("report", parents=[snap, db], help="print the summary tables")
    cmd.set_defaults(func=cmd_report)
    cmd = sub.add_parser("export", parents=[snap, db], help="write the public dataset (no author names)")
    cmd.add_argument("--out", type=Path, help="directory (default: census/data/export/<snapshot>)")
    cmd.set_defaults(func=cmd_export)
    cmd = sub.add_parser("label", parents=[snap, db], help="export a blind sample to hand-label")
    cmd.add_argument("--per-style", type=int, default=50, help="articles per text style")
    cmd.add_argument("--seed", type=int, default=20261013, help="seed for the sample")
    cmd.add_argument("--out", type=Path, help="CSV path (default: census/data/labels/<snapshot>.csv)")
    cmd.set_defaults(func=cmd_label)
    cmd = sub.add_parser("score", parents=[snap, db], help="score the parser against a labelled CSV")
    cmd.add_argument("labels", type=Path, help="the CSV from `census label`, with the gold column filled")
    cmd.set_defaults(func=cmd_score)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except Failure as error:
        print(f"census {args.command}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
