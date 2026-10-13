"""The DuckDB tables an extraction writes, and turning a parsed article into their rows."""

import hashlib
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

from census.jats import Article, parse_article, parse_element

SCHEMA_VERSION = "3"

ARTICLE_COLUMNS = {
    "pmcid": "VARCHAR PRIMARY KEY",
    "stratum": "VARCHAR",
    "source_unit": "VARCHAR",
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
CREATE TABLE IF NOT EXISTS paired (
    pmcid VARCHAR NOT NULL, author_position INTEGER NOT NULL, role VARCHAR NOT NULL,
    PRIMARY KEY (pmcid, author_position, role)
);
CREATE TABLE IF NOT EXISTS units (
    unit VARCHAR PRIMARY KEY, listed_date VARCHAR, size BIGINT, sha256 VARCHAR, articles INTEGER,
    retries INTEGER, finished BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
CREATE OR REPLACE VIEW paired_scores AS
WITH tagged AS (SELECT pmcid FROM articles WHERE style IN ('jats4r', 'plos_uri') AND statement IS NOT NULL),
gold AS (SELECT pmcid, author_position, role FROM assignments WHERE pmcid IN (SELECT pmcid FROM tagged)),
pairs AS (
    SELECT pmcid, g.role IS NOT NULL AS tagged, p.role IS NOT NULL AS parsed
    FROM gold g FULL JOIN paired p USING (pmcid, author_position, role)
),
counts AS (
    SELECT coalesce(a.publisher, '(all)') AS publisher, count(DISTINCT pmcid) AS articles,
           count(*) FILTER (tagged AND parsed) AS hits, count(*) FILTER (parsed) AS parsed,
           count(*) FILTER (tagged) AS tagged
    FROM pairs JOIN articles a USING (pmcid) GROUP BY ROLLUP (a.publisher)
)
SELECT publisher, articles, round(hits / nullif(parsed, 0), 3) AS precision,
       round(hits / nullif(tagged, 0), 3) AS recall, round(2 * hits / nullif(parsed + tagged, 0), 3) AS f1
FROM counts;
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
    paired: list[tuple[int, str]] = field(default_factory=list)
    """The statement parser's reading of a tagged article's statement, positions from 1."""

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
    """Rows for one article's XML (the bucket reader)."""
    digest = hashlib.sha256(xml).hexdigest()
    try:
        a = parse_article(xml)
    except Exception as error:  # one bad article must not stop a run over millions
        rows = failed_row(pmcid, stratum, "error", f"{type(error).__name__}: {error}", version)
        rows.article["xml_sha256"] = digest
        return rows
    return _rows(a, pmcid, stratum, version, digest, None)


def rows_for_element(element: ET.Element, stratum: str, unit: str) -> Rows | None:
    """Rows for one <article> of a bulk file, or None when it has no PMCID to key it by. The file's
    hash, in `units`, pins the XML; articles carry the file's name instead of their own hash."""
    ids = {i.get("pub-id-type"): (i.text or "").strip() for i in element.iterfind("front/article-meta/article-id")}
    pmcid = ids.get("pmcid") or (f"PMC{ids['pmc']}" if ids.get("pmc", "").isdigit() else "")
    if not pmcid.startswith("PMC"):
        return None
    try:
        a = parse_element(element)
    except Exception as error:
        rows = failed_row(pmcid, stratum, "error", f"{type(error).__name__}: {error}")
        rows.article["source_unit"] = unit
        return rows
    return _rows(a, pmcid, stratum, None, None, unit)


def _rows(a: Article, pmcid: str, stratum: str, version: int | None, digest: str | None, unit: str | None) -> Rows:
    article = {
        "pmcid": pmcid,
        "stratum": stratum,
        "source_unit": unit,
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
    return Rows(
        article,
        [(i + 1, slug) for i, slug in sorted(a.assignments)],
        [(i + 1, slug) for i, slug in sorted(a.paired or ())],
    )


def insert(con: duckdb.DuckDBPyConnection, batch: list[Rows], unit: dict[str, object] | None = None) -> None:
    """Write a batch, and the record of the unit it came from, in one transaction, so an interrupted
    run never leaves half an article or a unit marked finished without its rows.

    If DuckDB rejects the batch, each article is written on its own and a rejected one is stored as
    an error row, so one bad value does not stop the run on every resume.
    """
    try:
        _write(con, batch, unit)
    except duckdb.Error:
        for i, rows in enumerate(batch):
            last = unit if i == len(batch) - 1 else None
            try:
                _write(con, [rows], last)
            except duckdb.Error as error:
                a = rows.article
                _write(con, [failed_row(str(a["pmcid"]), str(a["stratum"]), "error", f"insert: {error}")], last)


def _write(con: duckdb.DuckDBPyConnection, batch: list[Rows], unit: dict[str, object] | None = None) -> None:
    con.begin()
    try:
        # Re-reading a unit replaces its articles' rows, so a unit can always be read again.
        ids = [r.article["pmcid"] for r in batch]
        for table in ("assignments", "paired", "articles"):
            con.execute(f"DELETE FROM {table} WHERE pmcid IN (SELECT unnest(?))", [ids])
        columns = list(ARTICLE_COLUMNS)
        _insert(con, "articles", columns, [[r.article.get(c) for c in columns] for r in batch])
        role_columns = ["pmcid", "author_position", "role"]
        _insert(con, "assignments", role_columns, [[r.article["pmcid"], p, role] for r in batch for p, role in r.roles])
        _insert(con, "paired", role_columns, [[r.article["pmcid"], p, role] for r in batch for p, role in r.paired])
        if unit is not None:
            con.execute(
                "INSERT OR REPLACE INTO units BY NAME SELECT * FROM (SELECT ? AS unit, ? AS listed_date, ? AS size,"
                " ? AS sha256, ? AS articles, ? AS retries, ? AS finished)",
                [unit.get(k) for k in ("unit", "listed_date", "size", "sha256", "articles", "retries", "finished")],
            )
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
