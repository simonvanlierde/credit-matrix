"""How published papers use CRediT roles; see the README in census/.

Order of use:
  1. census run (a sample, from the PMC bucket) or census bulk (every open-access article)
  2. census fields
  3. census report, export, label or score
"""

import argparse
import csv
import re
import sys
from pathlib import Path

from census import bulk, export, fields, labels, net, pipeline, pmc_s3, snapshot, store
from census.reports import REPORTS

ROOT = Path(__file__).resolve().parents[2]  # census/, so commands work from any directory
SNAPSHOTS = ROOT / "snapshots"
DATA = ROOT / "data"
INVENTORY_RE = re.compile(r"\d{4}-\d\d-\d\dT\d\d-\d\dZ")


class Failure(Exception):
    """A mistake the user can fix: printed as one line, exit code 1."""

    code = 1


class Unfinished(Failure):
    """A run that stopped or left units unfinished: exit code 2, so a script can rerun it."""

    code = 2


def _manifest(name: str) -> Path:
    path = SNAPSHOTS / f"{name}.csv"
    if not path.exists():
        known = ", ".join(sorted(p.stem for p in SNAPSHOTS.glob("*.csv"))) or "none"
        raise Failure(f"no manifest {path}; known snapshots: {known}")
    return path


def _db(args: argparse.Namespace, must_exist: bool = True) -> Path:
    db: Path = args.db or DATA / f"{args.snapshot}.duckdb"
    if must_exist and not db.exists():
        raise Failure(f"no database {db}; build it with `census bulk` (or `census run`) --snapshot {args.snapshot}")
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
    committed = pin_file.read_text(encoding="utf-8").strip() if pin_file.exists() else None
    with store.connect(db) as con:
        (used,) = con.execute("SELECT value FROM meta WHERE key = 'inventory'").fetchone() or (None,)
        # The committed pin wins over the newest inventory, so a clean clone reproduces the sample.
        date = pmc_s3.latest_inventory() if args.inventory == "latest" else args.inventory or used or committed
        date = date or pmc_s3.latest_inventory()
        if committed and date != committed:
            raise Failure(
                f"snapshot {args.snapshot} is pinned to inventory {committed}; draw a new snapshot for {date}"
            )
        if store.pin(con, "inventory", date) != date:
            raise Failure(f"{db} was read from inventory {used}; use --fresh or another --db to read {date}")
    for tmp in args.xml_cache.glob("*.tmp"):  # half writes of a killed run
        tmp.unlink(missing_ok=True)
    versions = pmc_s3.load_versions(date, DATA / f"pmc-inventory-{date}.parquet")
    source = pmc_s3.BucketSource(manifest, versions, pmc_s3.CachedFetch(args.xml_cache), args.workers)
    counts = pipeline.run(source, db, args.processes)
    if committed is None and "stopped" not in counts:
        pin_file.write_text(date + "\n", encoding="utf-8")
    print(f"inventory {date}: " + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())))
    _check_finished(db, counts)


def _open_db(args: argparse.Namespace, source: str) -> Path:
    """The run's database, after --fresh and the parser, schema and source pins are checked."""
    db = _db(args, must_exist=False)
    if args.fresh:
        db.unlink(missing_ok=True)
    with store.connect(db) as con:
        if (pinned := store.pin(con, "source", source)) != source:
            raise Failure(f"{db} was read from source {pinned} (this run: {source}); rerun with --fresh")
    return db


def _check_finished(db: Path, counts: dict[str, int]) -> None:
    """Raise Unfinished when the run stopped or left units unfinished, listing each such unit on stderr."""
    with store.connect(db, read_only=True) as con:
        failed = con.execute("SELECT unit, error FROM units WHERE NOT finished ORDER BY unit").fetchall()
    for unit, error in failed:
        print(f"{unit}: {error}", file=sys.stderr)
    reasons = ["the run stopped"] * ("stopped" in counts) + [f"{len(failed)} units unfinished"] * bool(failed)
    if reasons:
        raise Unfinished(f"{' and '.join(reasons)}; see the errors above, then rerun to resume")


def cmd_bulk(args: argparse.Namespace) -> None:
    db = _open_db(args, "bulk")
    pin_file = SNAPSHOTS / f"{args.snapshot}.files.csv"
    if pin_file.exists():
        with pin_file.open(newline="", encoding="utf-8") as f:
            files = list(csv.DictReader(f))
    else:
        # The listing this snapshot reads, committed before any download: the weekly refresh can
        # replace files, and the hashes written at the end show which content was read.
        files = bulk.list_files()
        _write_files(pin_file, files)
    for tmp in args.cache.glob("*.tmp"):  # half downloads of a killed run
        tmp.unlink(missing_ok=True)
    source = bulk.BulkSource(files, args.cache)
    counts = pipeline.run(source, db, args.processes, args.limit)
    with store.connect(db, read_only=True) as con:
        hashes = dict(con.execute("SELECT unit, sha256 FROM units WHERE finished").fetchall())
    # Only empty hashes are filled in: a pinned one is the content the snapshot read, and a file that no
    # longer matches it fails its unit instead.
    _write_files(pin_file, [{**f, "sha256": f.get("sha256") or hashes.get(f["unit"], "")} for f in files])
    print(f"{len(hashes)}/{len(files)} files read: " + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())))
    _check_finished(db, counts)


def _write_files(path: Path, files: list[dict[str, str]]) -> None:
    with net.replacing(path) as tmp, tmp.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["unit", "listed_date", "sha256"], lineterminator="\n", extrasaction="ignore"
        )
        writer.writeheader()
        writer.writerows({"sha256": "", **row} for row in files)


def cmd_fields(args: argparse.Namespace) -> None:
    with store.connect(_db(args)) as con:
        print(f"{fields.build_journals(con, args.sources)} journals with a field")


def cmd_report(args: argparse.Namespace) -> None:
    with store.connect(_db(args), read_only=True) as con:
        has_fields = fields.has_fields(con)
        for title, query in REPORTS.items():
            if "article_fields" in query and not has_fields:
                print(f"\n{title}: run `census fields` first")
                continue
            print(f"\n{title}")
            con.sql(query).show(max_rows=60, max_width=200)


def cmd_export(args: argparse.Namespace) -> None:
    out = args.out or DATA / "export" / args.snapshot
    with store.connect(_db(args), read_only=True) as con:
        try:
            counts = export.export(con, out, args.snapshot, partial=args.partial)
        except ValueError as error:
            raise Failure(error) from error
    print(f"{out}: " + ", ".join(f"{v} {k}" for k, v in counts.items()))


def cmd_label(args: argparse.Namespace) -> None:
    out = args.out or DATA / "labels" / f"{args.snapshot}{'-set' if args.set else ''}.csv"
    with store.connect(_db(args), read_only=True) as con:
        if not args.set:
            print(f"{labels.export(con, out, args.per_style, args.seed)} articles to label in {out}")
            return
        disagreements = out.with_stem(out.stem + "-disagreements")
        n = labels.export_set(con, out, args.seed)
        m = labels.export_disagreements(con, disagreements, args.seed)
    print(f"{n} articles to label in {out} (strata in {labels.key_path(out)}), {m} to judge in {disagreements}")


def cmd_score(args: argparse.Namespace) -> None:
    with args.labels.open(encoding="utf-8-sig") as f:
        header = f.readline()
    with store.connect(_db(args), read_only=True) as con:
        try:
            if "wrong" in header.strip().split(","):
                for verdict, n in labels.verdicts(args.labels).most_common():
                    print(f"{verdict:<10}{n:>4}")
                return
            tables = {by: labels.score(con, args.labels, by, args.key) for by in ("style", "publisher")}
            second = args.second and labels.agreement(con, args.labels, args.second)
        except ValueError as error:
            raise Failure(error) from error
    # Rates are weighted by stratum; "-" is a rate with nothing to count.
    for by, results in tables.items():
        print(f"{by:<56}{'articles':>9}{'precision':>11}{'recall':>8}{'f1':>7}{'exact':>7}{'exact 95%':>13}")
        for key, n, *rates, low, high in results:
            p, r, f1, exact = ("-" if x is None else x for x in rates)
            print(f"{key[:55]:<56}{n:>9}{p:>11}{r:>8}{f1:>7}{exact:>7}{f'{low}-{high}':>13}")
        print()
    print("The publisher rows hold a few articles each: read them for failure patterns, not accuracy.")
    if second:
        n, _, _, f1, exact, _, _ = second
        print(f"second labeller against the first: {n} overlap articles, f1 {'-' if f1 is None else f1}, exact {exact}")


def main(argv: list[str] | None = None) -> int:
    def snapshot_option(default: str) -> argparse.ArgumentParser:
        parent = argparse.ArgumentParser(add_help=False)
        parent.add_argument("--snapshot", default=default, help=f"name in census/snapshots/ (default: {default})")
        return parent

    snap, sample = snapshot_option("oa-2026-10"), snapshot_option("sample-2026-10")
    db = argparse.ArgumentParser(add_help=False)
    db.add_argument("--db", type=Path, help="database (default: census/data/<snapshot>.duckdb)")
    parser = argparse.ArgumentParser(
        prog="census", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    cmd = sub.add_parser("snapshot", parents=[sample], help="draw a stratified sample from Europe PMC")
    cmd.add_argument("--per-cell", type=int, default=15, help="articles per publisher and year")
    cmd.add_argument("--seed", type=int, default=20261013, help="seed for the draw")
    cmd.set_defaults(func=cmd_snapshot)
    cmd = sub.add_parser("run", parents=[sample, db], help="read the manifest from the PMC bucket into the database")
    cmd.add_argument("--inventory", help="bucket inventory date, or 'latest' (default: the snapshot's pin)")
    cmd.add_argument("--workers", type=int, default=16, help="parallel downloads in each process")
    cmd.add_argument("--processes", type=int, default=8, help="worker processes (0: none)")
    cmd.add_argument("--fresh", action="store_true", help="delete the database first (cached XML is reused)")
    cmd.add_argument("--xml-cache", type=Path, default=DATA / "xml-cache", help="gzipped XML kept for re-parsing")
    cmd.set_defaults(func=cmd_run)
    cmd = sub.add_parser("bulk", parents=[snap, db], help="read every open-access article from Europe PMC's bulk files")
    cmd.add_argument("--processes", type=int, default=16, help="files downloaded and parsed at once (0: none)")
    cmd.add_argument("--fresh", action="store_true", help="delete the database first (downloaded files are reused)")
    cmd.add_argument("--cache", type=Path, default=DATA / "bulk", help="where the bulk files are kept (about 169 GB)")
    cmd.add_argument("--limit", type=int, help="read at most this many unread files, to try a run")
    cmd.set_defaults(func=cmd_bulk)
    cmd = sub.add_parser("fields", parents=[snap, db], help="add journal fields from OpenAlex")
    cmd.add_argument("--sources", default=fields.OPENALEX_SOURCES, help="OpenAlex sources Parquet")
    cmd.set_defaults(func=cmd_fields)
    cmd = sub.add_parser("report", parents=[snap, db], help="print the summary tables")
    cmd.set_defaults(func=cmd_report)
    cmd = sub.add_parser(
        "export",
        parents=[snap, db],
        help="write the public dataset (no names in the role tables; statements only from CC BY and CC0 articles)",
    )
    cmd.add_argument("--partial", action="store_true", help="export even with unfinished units or no fields")
    cmd.add_argument("--out", type=Path, help="directory (default: census/data/export/<snapshot>)")
    cmd.set_defaults(func=cmd_export)
    cmd = sub.add_parser("label", parents=[snap, db], help="export a blind sample to hand-label")
    cmd.add_argument("--per-style", type=int, default=50, help="articles per text style")
    cmd.add_argument("--seed", type=int, default=20261013, help="seed for the sample")
    cmd.add_argument("--out", type=Path, help="CSV path (default: census/data/labels/<snapshot>.csv)")
    cmd.add_argument(
        "--set",
        action="store_true",
        help="write the label set instead: publishers without paired articles, by publisher and style, an overlap"
        " for a second labeller, the strata and weights in a -key.csv beside it, and paired disagreements to judge"
        " (default: census/data/labels/<snapshot>-set.csv)",
    )
    cmd.set_defaults(func=cmd_label)
    cmd = sub.add_parser("score", parents=[snap, db], help="score the parser against a labelled CSV")
    cmd.add_argument(
        "labels", type=Path, help="the CSV from `census label`, gold filled (or a disagreement file, wrong filled)"
    )
    cmd.add_argument("--second", type=Path, help="a second labeller's copy, scored against the first on the overlap")
    cmd.add_argument("--key", type=Path, help="the label set's strata and weights (default: <labels>-key.csv if there)")
    cmd.set_defaults(func=cmd_score)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (Failure, store.PinMismatch) as error:
        print(f"census {args.command}: {error}", file=sys.stderr)
        return getattr(error, "code", 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
