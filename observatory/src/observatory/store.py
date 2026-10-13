"""The DuckDB tables an extraction writes, and turning a parsed article into their rows."""

import hashlib
from pathlib import Path

import duckdb

from observatory.jats import Article, parse_article

SCHEMA = """
CREATE TABLE IF NOT EXISTS articles (
    pmcid VARCHAR PRIMARY KEY, stratum VARCHAR, version INTEGER, xml_sha256 VARCHAR, article_type VARCHAR,
    doi VARCHAR, journal VARCHAR, issn VARCHAR[], publisher VARCHAR, year INTEGER, license VARCHAR,
    style VARCHAR, authors VARCHAR[], n_authors INTEGER, n_authors_with_roles INTEGER, statement VARCHAR,
    unresolved VARCHAR[], error VARCHAR
);
CREATE TABLE IF NOT EXISTS assignments (
    pmcid VARCHAR, author_position INTEGER, author_name VARCHAR, orcid VARCHAR, role VARCHAR
);
CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
"""

Rows = tuple[tuple, list[tuple]]
"""One articles row and its assignments rows."""


def connect(db: Path, fresh: bool = False) -> duckdb.DuckDBPyConnection:
    db.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db))
    if fresh:
        con.execute("DROP TABLE IF EXISTS articles; DROP TABLE IF EXISTS assignments; DROP TABLE IF EXISTS meta")
    con.execute(SCHEMA)
    return con


def pin(con: duckdb.DuckDBPyConnection, key: str, value: str) -> str:
    """The value `key` was first pinned to in this database, pinning it to `value` if unset."""
    con.execute("INSERT INTO meta VALUES (?, ?) ON CONFLICT DO NOTHING", [key, value])
    (pinned,) = con.execute("SELECT value FROM meta WHERE key = ?", [key]).fetchone() or (value,)
    return pinned


def done(con: duckdb.DuckDBPyConnection) -> set[str]:
    """PMCIDs already in the articles table, which a resumed run skips."""
    return {pmcid for (pmcid,) in con.execute("SELECT pmcid FROM articles").fetchall()}


def failed_row(pmcid: str, stratum: str, style: str, error: str, version: int | None = None) -> Rows:
    """`style` is "error" (the XML does not parse), "missing" (no XML to read) or "retry" (download failed)."""
    return (pmcid, stratum, version, *[None] * 8, style, [], 0, 0, None, [], error), []


def rows_for(pmcid: str, stratum: str, xml: bytes, version: int | None = None) -> Rows:
    digest = hashlib.sha256(xml).hexdigest()
    try:
        a: Article = parse_article(xml)
    except (ValueError, SyntaxError) as error:  # ET.ParseError is a SyntaxError
        row, _ = failed_row(pmcid, stratum, "error", str(error), version)
        return (*row[:3], digest, *row[4:]), []
    article = (
        pmcid, stratum, version, digest, a.article_type, a.doi, a.journal, a.issn, a.publisher, a.year, a.license,
        a.style, [x.name for x in a.authors], len(a.authors), len({i for i, _ in a.assignments}), a.statement,
        a.unresolved, None,
    )  # fmt: skip
    roles = [(pmcid, i + 1, a.authors[i].name, a.authors[i].orcid, slug) for i, slug in sorted(a.assignments)]
    return article, roles


def insert(con: duckdb.DuckDBPyConnection, batch: list[Rows]) -> None:
    """Write a batch in one transaction, so an interrupted run never leaves half an article."""
    con.begin()
    _insert(con, "articles", [article for article, _ in batch])
    _insert(con, "assignments", [row for _, roles in batch for row in roles])
    con.commit()


def _insert(con: duckdb.DuckDBPyConnection, table: str, rows: list[tuple], chunk: int = 500) -> None:
    """Multi-row INSERTs. DuckDB's executemany runs one statement per row, about 10 times slower here."""
    for start in range(0, len(rows), chunk):
        part = rows[start : start + chunk]
        values = ", ".join([f"({', '.join('?' * len(part[0]))})"] * len(part))
        con.execute(f"INSERT INTO {table} VALUES {values}", [v for row in part for v in row])
