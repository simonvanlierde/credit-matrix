"""The DuckDB tables an extraction writes, and turning a parsed article into their rows."""

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

from census.jats import parse_article

SCHEMA_VERSION = "2"

ARTICLE_COLUMNS = {
    "pmcid": "VARCHAR PRIMARY KEY",
    "stratum": "VARCHAR",
    "version": "INTEGER",
    "xml_sha256": "VARCHAR",
    "article_type": "VARCHAR",
    "doi": "VARCHAR",
    "journal": "VARCHAR",
    "issn": "VARCHAR[]",
    "publisher": "VARCHAR",
    "year": "INTEGER",
    "license": "VARCHAR",
    "style": "VARCHAR NOT NULL",
    "authors": "VARCHAR[]",
    "orcids": "VARCHAR[]",
    "n_authors": "INTEGER",
    "n_authors_with_roles": "INTEGER",
    "statement": "VARCHAR",
    "unresolved": "VARCHAR[]",
    "error": "VARCHAR",
}
"""Column -> type. `authors` and `orcids` run in author order (an ORCID is NULL when the article gives
none); they stay local, the public export leaves names out."""

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS articles ({", ".join(f"{c} {t}" for c, t in ARTICLE_COLUMNS.items())});
CREATE TABLE IF NOT EXISTS assignments (
    pmcid VARCHAR NOT NULL, author_position INTEGER NOT NULL, role VARCHAR NOT NULL,
    PRIMARY KEY (pmcid, author_position, role)
);
CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
"""

_PARSER_FILES = ("roles.py", "statement.py", "jats.py", "store.py")
PARSER_VERSION = hashlib.sha256(
    b"".join((Path(__file__).parent / name).read_bytes() for name in _PARSER_FILES)
).hexdigest()[:12]
"""Changes whenever the code that turns XML into rows changes, so one database never mixes parsers."""


@dataclass
class Rows:
    article: dict[str, object]
    roles: list[tuple[int, str]] = field(default_factory=list)
    """(author position, role slug) pairs, positions counted from 1."""

    @property
    def style(self) -> str:
        return str(self.article["style"])


def connect(db: Path) -> duckdb.DuckDBPyConnection:
    db.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db))
    con.execute(SCHEMA)
    return con


def pin(con: duckdb.DuckDBPyConnection, key: str, value: str) -> str:
    """The value `key` was first pinned to in this database, pinning it to `value` if unset."""
    con.execute("INSERT INTO meta VALUES (?, ?) ON CONFLICT DO NOTHING", [key, value])
    (pinned,) = con.execute("SELECT value FROM meta WHERE key = ?", [key]).fetchone() or (value,)
    return pinned


def mismatched_pins(con: duckdb.DuckDBPyConnection) -> list[str]:
    """Pins this code disagrees with: rows from another parser or schema must not be mixed in."""
    expected = {"schema": SCHEMA_VERSION, "parser": PARSER_VERSION}
    pinned = dict(con.execute("SELECT key, value FROM meta").fetchall())
    (rows,) = con.execute("SELECT count(*) FROM articles").fetchone() or (0,)
    if rows and "parser" not in pinned:
        return ["rows from code that pinned no parser version"]
    return [f"{k} {pin(con, k, v)} (this code: {v})" for k, v in expected.items() if pin(con, k, v) != v]


def done(con: duckdb.DuckDBPyConnection) -> set[str]:
    """PMCIDs already in the articles table, which a resumed run skips."""
    return {pmcid for (pmcid,) in con.execute("SELECT pmcid FROM articles").fetchall()}


def failed_row(pmcid: str, stratum: str, style: str, error: str, version: int | None = None) -> Rows:
    """`style` is "error" (the XML does not parse), "missing" (no XML to read) or "retry" (download failed)."""
    return Rows({"pmcid": pmcid, "stratum": stratum, "version": version, "style": style, "error": error})


def rows_for(pmcid: str, stratum: str, xml: bytes, version: int | None = None) -> Rows:
    digest = hashlib.sha256(xml).hexdigest()
    try:
        a = parse_article(xml)
    except Exception as error:  # one bad article must not stop a run over millions
        rows = failed_row(pmcid, stratum, "error", f"{type(error).__name__}: {error}", version)
        rows.article["xml_sha256"] = digest
        return rows
    article = {
        "pmcid": pmcid,
        "stratum": stratum,
        "version": version,
        "xml_sha256": digest,
        "article_type": a.article_type,
        "doi": a.doi,
        "journal": a.journal,
        "issn": a.issn,
        "publisher": a.publisher,
        "year": a.year,
        "license": a.license,
        "style": a.style,
        "authors": [x.name for x in a.authors],
        "orcids": [x.orcid for x in a.authors],
        "n_authors": len(a.authors),
        "n_authors_with_roles": len({i for i, _ in a.assignments}),
        "statement": a.statement,
        "unresolved": a.unresolved,
    }
    return Rows(article, [(i + 1, slug) for i, slug in sorted(a.assignments)])


def insert(con: duckdb.DuckDBPyConnection, batch: list[Rows]) -> None:
    """Write a batch in one transaction, so an interrupted run never leaves half an article.

    If DuckDB rejects the batch, each article is written on its own and a rejected one is stored as
    an error row, so one bad value does not stop the run on every resume.
    """
    try:
        _write(con, batch)
    except duckdb.Error:
        for rows in batch:
            try:
                _write(con, [rows])
            except duckdb.Error as error:
                a = rows.article
                _write(con, [failed_row(str(a["pmcid"]), str(a["stratum"]), "error", f"insert: {error}")])


def _write(con: duckdb.DuckDBPyConnection, batch: list[Rows]) -> None:
    con.begin()
    try:
        columns = list(ARTICLE_COLUMNS)
        _insert(con, "articles", columns, [[r.article.get(c) for c in columns] for r in batch])
        _insert(con, "assignments", ["pmcid", "author_position", "role"],
                [[r.article["pmcid"], pos, role] for r in batch for pos, role in r.roles])  # fmt: skip
        con.commit()
    except duckdb.Error:
        con.rollback()
        raise


def _insert(con: duckdb.DuckDBPyConnection, table: str, columns: list[str], rows: list[list], chunk: int = 500) -> None:
    """Multi-row INSERTs with named columns. DuckDB's executemany runs one statement per row, about 10
    times slower here."""
    for start in range(0, len(rows), chunk):
        part = rows[start : start + chunk]
        values = ", ".join([f"({', '.join('?' * len(columns))})"] * len(part))
        con.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES {values}", [v for row in part for v in row])
