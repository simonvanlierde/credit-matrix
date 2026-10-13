"""observatory snapshot | fetch | extract | report. Run from the observatory/ directory."""

import argparse
import sys
from pathlib import Path

import duckdb

from observatory.jats import parse_article
from observatory.snapshot import draw, fetch, read_manifest, write_manifest

SNAPSHOTS = Path("snapshots")
XML_DIR = Path("data/xml")
DB = Path("data/observatory.duckdb")

SCHEMA = """
CREATE OR REPLACE TABLE articles (
    pmcid VARCHAR PRIMARY KEY, stratum VARCHAR, article_type VARCHAR, doi VARCHAR, journal VARCHAR, publisher VARCHAR,
    year INTEGER, license VARCHAR, style VARCHAR, n_authors INTEGER, n_authors_with_roles INTEGER,
    statement VARCHAR, unresolved VARCHAR[], error VARCHAR
);
CREATE OR REPLACE TABLE assignments (
    pmcid VARCHAR, author_position INTEGER, author_name VARCHAR, orcid VARCHAR, role VARCHAR
);
"""

REPORT = """
SELECT stratum, style, count(*) AS articles,
       round(avg(n_authors_with_roles / nullif(n_authors, 0)), 3) AS author_coverage
FROM articles GROUP BY ALL ORDER BY stratum, articles DESC
"""


def extract(manifest: list[dict[str, str]], xml_dir: Path, db: Path) -> int:
    """Parse every fetched article into the articles and assignments tables. Returns the error count."""
    articles, assignments, errors = [], [], 0
    for row in manifest:
        path = xml_dir / f"{row['pmcid']}.xml"
        if not path.exists():
            continue
        try:
            a = parse_article(path.read_bytes())
        except (ValueError, SyntaxError) as error:  # ET.ParseError is a SyntaxError
            errors += 1
            articles.append((row["pmcid"], row["stratum"], *[None] * 6, "error", 0, 0, None, [], str(error)))
            continue
        with_roles = {i for i, _ in a.assignments}
        articles.append(
            (row["pmcid"], row["stratum"], a.article_type, a.doi, a.journal, a.publisher, a.year, a.license, a.style,
             len(a.authors), len(with_roles), a.statement, a.unresolved, None)
        )  # fmt: skip
        assignments += [
            (row["pmcid"], i + 1, a.authors[i].name, a.authors[i].orcid, slug) for i, slug in sorted(a.assignments)
        ]
    db.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect(str(db)) as con:
        con.execute(SCHEMA)
        _insert(con, "articles", articles)
        _insert(con, "assignments", assignments)
    return errors


def _insert(con: duckdb.DuckDBPyConnection, table: str, rows: list[tuple], batch: int = 500) -> None:
    """Multi-row INSERTs. DuckDB's executemany runs one statement per row, about 10 times slower here."""
    for start in range(0, len(rows), batch):
        chunk = rows[start : start + batch]
        values = ", ".join([f"({', '.join('?' * len(chunk[0]))})"] * len(chunk))
        con.execute(f"INSERT INTO {table} VALUES {values}", [v for row in chunk for v in row])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="observatory", description=__doc__)
    parser.add_argument("--snapshot", default="sample-2026-10", help="manifest name under snapshots/")
    sub = parser.add_subparsers(dest="command", required=True)
    draw_cmd = sub.add_parser("snapshot", help="draw a new stratified sample and write its manifest")
    draw_cmd.add_argument("--per-cell", type=int, default=15, help="articles per publisher and year")
    draw_cmd.add_argument("--seed", type=int, default=20261013)
    sub.add_parser("fetch", help="download the manifest's JATS and check it against the pinned hashes")
    sub.add_parser("extract", help=f"parse the fetched JATS into {DB}")
    sub.add_parser("report", help="articles and author coverage per publisher and markup style")
    args = parser.parse_args(argv)

    manifest_path = SNAPSHOTS / f"{args.snapshot}.csv"
    if args.command == "snapshot":
        if manifest_path.exists():
            print(f"{manifest_path} exists; a pinned snapshot is never redrawn. Pick a new --snapshot name.")
            return 1
        rows = draw(args.per_cell, args.seed)
        write_manifest(rows, manifest_path)
        print(f"{len(rows)} articles in {manifest_path}")
    elif args.command == "fetch":
        counts = fetch(read_manifest(manifest_path), XML_DIR, manifest_path.with_suffix(".sha256"))
        print(", ".join(f"{v} {k}" for k, v in counts.items()))
        return 1 if counts["changed"] else 0
    elif args.command == "extract":
        errors = extract(read_manifest(manifest_path), XML_DIR, DB)
        print(f"extracted into {DB}; {errors} articles failed to parse")
    elif args.command == "report":
        with duckdb.connect(str(DB), read_only=True) as con:
            con.sql(REPORT).show(max_rows=200)
    return 0


if __name__ == "__main__":
    sys.exit(main())
