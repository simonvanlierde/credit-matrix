"""How published papers use CRediT roles. Run from the observatory/ directory; see the README."""

import argparse
import json
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from observatory import fields, labels, pmc_s3, snapshot, store
from observatory.net import get

SNAPSHOTS = Path("snapshots")
DATA = Path("data")
XML_DIR = DATA / "xml"

# Research articles only: corrections, editorials and the like carry no statement.
REPORTS = {
    "Markup style per publisher stratum": """
        SELECT stratum, style, count(*) AS articles,
               round(avg(n_authors_with_roles / nullif(n_authors, 0)), 3) AS author_coverage
        FROM articles WHERE article_type = 'research-article' GROUP BY ALL ORDER BY stratum, articles DESC""",
    "Articles with roles, per year": """
        SELECT year, count(*) AS articles, round(avg((n_authors_with_roles > 0)::INT), 3) AS with_roles
        FROM articles WHERE article_type = 'research-article' AND year IS NOT NULL GROUP BY year ORDER BY year""",
    "Share of authors holding each role, by author position": """
        WITH authors AS (
            SELECT a.pmcid, p.position,
                   CASE WHEN p.position = 1 THEN 'first' WHEN p.position = a.n_authors THEN 'last' ELSE 'middle'
                   END AS place
            FROM articles a, range(1, a.n_authors + 1) p(position)
            WHERE a.n_authors_with_roles > 0 AND a.n_authors > 2 AND a.article_type = 'research-article'
        )
        PIVOT (
            SELECT r.role, au.place, count(*) / any_value(t.n) AS share
            FROM authors au
            JOIN assignments r ON r.pmcid = au.pmcid AND r.author_position = au.position
            JOIN (SELECT place, count(*) AS n FROM authors GROUP BY place) t USING (place)
            GROUP BY r.role, au.place
        ) ON place IN ('first', 'middle', 'last') USING round(any_value(share), 3) ORDER BY role""",
    "Articles with roles, per field (run `fields` first)": """
        SELECT f.field, count(*) AS articles, round(avg((a.n_authors_with_roles > 0)::INT), 3) AS with_roles
        FROM articles a JOIN article_fields f USING (pmcid)
        WHERE a.article_type = 'research-article' GROUP BY ALL ORDER BY articles DESC LIMIT 30""",
}


def extract(manifest: list[dict[str, str]], xml_dir: Path, db: Path) -> int:
    """Parse every fetched article into a fresh database. Returns the count that failed to parse."""
    batch = [
        store.rows_for(row["pmcid"], row["stratum"], (xml_dir / f"{row['pmcid']}.xml").read_bytes())
        for row in manifest
        if (xml_dir / f"{row['pmcid']}.xml").exists()
    ]
    with store.connect(db, fresh=True) as con:
        store.insert(con, batch)
    return sum(article[11] == "error" for article, _ in batch)


def run(
    manifest: list[dict[str, str]],
    versions: dict[str, int],
    db: Path,
    workers: int,
    fetch: Callable[[str], bytes] = get,
) -> dict[str, int]:
    """Stream the manifest's articles from the PMC bucket into `db`, skipping those already there."""
    with store.connect(db) as con:
        finished = store.done(con)
        todo = [row for row in manifest if row["pmcid"] not in finished]
        counts: dict[str, int] = {}
        batch: list[store.Rows] = []
        start = time.monotonic()
        for i, rows in enumerate(pmc_s3.stream(todo, versions, workers, fetch), 1):
            style = rows[0][11]
            counts[style] = counts.get(style, 0) + 1
            if style != "retry":  # left out, so the next run tries it again
                batch.append(rows)
            if len(batch) >= 1000 or i == len(todo):
                store.insert(con, batch)
                batch = []
                rate = i / (time.monotonic() - start)
                print(f"{i}/{len(todo)} done, {rate:.0f} a second", file=sys.stderr, flush=True)
    return counts


def _every(step: int, unit: str) -> Callable[[int], None]:
    """A progress callback that prints each time the count passes another `step`."""
    last = [0]

    def report(n: int) -> None:
        if n // step > last[0]:
            last[0] = n // step
            print(f"{n} {unit}", file=sys.stderr, flush=True)

    return report


def main(argv: list[str] | None = None) -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--snapshot", default="sample-2026-10", help="manifest name under snapshots/")
    common.add_argument("--db", type=Path, help="database (default: data/<snapshot>.duckdb)")
    parser = argparse.ArgumentParser(prog="observatory", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    cmd = sub.add_parser("snapshot", parents=[common], help="draw a stratified sample from Europe PMC")
    cmd.add_argument("--per-cell", type=int, default=15, help="articles per publisher and year")
    cmd.add_argument("--seed", type=int, default=20261013)
    sub.add_parser("candidates", parents=[common], help="list every candidate article in Europe PMC")
    sub.add_parser("fetch", parents=[common], help="download the manifest's JATS from Europe PMC into data/xml/")
    sub.add_parser("extract", parents=[common], help="parse the downloaded JATS into the database")
    cmd = sub.add_parser("run", parents=[common], help="stream the manifest from the PMC bucket into the database")
    cmd.add_argument("--inventory", help="PMC bucket inventory date (default: the newest; pinned on first run)")
    cmd.add_argument("--workers", type=int, default=32, help="parallel downloads")
    cmd.add_argument("--fresh", action="store_true", help="start the database over (cached XML is reused)")
    cmd.add_argument("--xml-cache", type=Path, default=DATA / "xml-cache", help="gzipped XML kept for re-parsing")
    cmd = sub.add_parser("fields", parents=[common], help="add journal fields from OpenAlex")
    cmd.add_argument("--sources", default=fields.OPENALEX_SOURCES, help="OpenAlex sources Parquet")
    sub.add_parser("report", parents=[common], help="print the summary tables")
    cmd = sub.add_parser("label", parents=[common], help="export a blind sample to hand-label")
    cmd.add_argument("--per-style", type=int, default=50)
    cmd.add_argument("--seed", type=int, default=20261013)
    cmd.add_argument("--out", type=Path, help="CSV path (default: data/labels/<snapshot>.csv)")
    cmd = sub.add_parser("score", parents=[common], help="score the parser against a labelled CSV")
    cmd.add_argument("labels", type=Path)
    args = parser.parse_args(argv)

    manifest_path = next(
        (p for p in (SNAPSHOTS / f"{args.snapshot}.csv", DATA / f"{args.snapshot}.csv.gz") if p.exists()),
        SNAPSHOTS / f"{args.snapshot}.csv",
    )
    db: Path = args.db or DATA / f"{args.snapshot}.duckdb"

    if args.command in {"snapshot", "candidates"}:
        if manifest_path.exists():
            print(f"{manifest_path} exists; a pinned snapshot is never redrawn. Pick a new --snapshot name.")
            return 1
        if args.command == "snapshot":
            rows = snapshot.draw(args.per_cell, args.seed)
            snapshot.write_manifest(rows, manifest_path)
        else:
            # Too large for git: the list goes to data/ and into the published dataset; its query,
            # date and count are committed next to the samples.
            manifest_path = DATA / f"{args.snapshot}.csv.gz"
            ids = snapshot.search_ids(
                snapshot.CANDIDATE_QUERY,
                progress=_every(50_000, "PMCIDs"),
            )
            rows = [{"pmcid": pmcid, "stratum": "all", "year": ""} for pmcid in sorted(set(ids))]
            snapshot.write_manifest(rows, manifest_path)
            meta = {"query": snapshot.CANDIDATE_QUERY, "date": datetime.now(UTC).date().isoformat(), "count": len(rows)}
            (SNAPSHOTS / f"{args.snapshot}.json").write_text(json.dumps(meta, indent=2) + "\n")
        print(f"{len(rows)} articles in {manifest_path}")
    elif args.command == "fetch":
        counts = snapshot.fetch(snapshot.read_manifest(manifest_path), XML_DIR, manifest_path.with_suffix(".sha256"))
        print(", ".join(f"{v} {k}" for k, v in counts.items()))
        return 1 if counts["changed"] else 0
    elif args.command == "extract":
        errors = extract(snapshot.read_manifest(manifest_path), XML_DIR, db)
        print(f"extracted into {db}; {errors} articles failed to parse")
    elif args.command == "run":
        if args.fresh:
            store.connect(db, fresh=True).close()
        with store.connect(db) as con:
            (pinned,) = con.execute("SELECT value FROM meta WHERE key = 'inventory'").fetchone() or (None,)
            date = args.inventory or pinned or pmc_s3.latest_inventory()
            if store.pin(con, "inventory", date) != date:
                print(f"{db} was read from inventory {pinned}; use --fresh or another --db to read {date}.")
                return 1
        # The record of which inventory a snapshot was last read from, committed with the manifest.
        (SNAPSHOTS / f"{args.snapshot}.inventory").write_text(date + "\n")
        versions = pmc_s3.load_versions(date, DATA / f"pmc-inventory-{date}.parquet")
        fetch = pmc_s3.cached(get, args.xml_cache)
        counts = run(snapshot.read_manifest(manifest_path), versions, db, args.workers, fetch)
        print(f"inventory {date}: " + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())))
    elif args.command == "fields":
        with store.connect(db) as con:
            print(f"{fields.build_journals(con, args.sources)} journals with a field")
    elif args.command == "report":
        with duckdb.connect(str(db), read_only=True) as con:
            has_fields = con.execute(
                "SELECT count(*) FROM duckdb_views() WHERE view_name = 'article_fields'"
            ).fetchone()
            for title, query in REPORTS.items():
                if "article_fields" in query and not (has_fields and has_fields[0]):
                    continue
                print(f"\n{title}")
                con.sql(query).show(max_rows=60, max_width=200)
    elif args.command == "label":
        out = args.out or DATA / "labels" / f"{args.snapshot}.csv"
        with duckdb.connect(str(db), read_only=True) as con:
            print(f"{labels.export(con, out, args.per_style, args.seed)} articles to label in {out}")
    elif args.command == "score":
        with duckdb.connect(str(db), read_only=True) as con:
            results = labels.score(con, args.labels)
        print(f"{'style':<16}{'articles':>9}{'precision':>11}{'recall':>8}{'f1':>7}{'exact':>7}")
        for style, n, p, r, f1, exact in results:
            print(f"{style:<16}{n:>9}{p:>11}{r:>8}{f1:>7}{exact:>7}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
