"""The DuckDB tables an extraction writes, the writer, and the pins that keep one database to one parser."""

import hashlib
import sys
from pathlib import Path
from typing import NotRequired, TypedDict

import duckdb
import pyarrow as pa

from census.rows import Rows, failed_row
from census.rows import rows_for as rows_for  # re-exported: callers use store.rows_for

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

_ARROW_TYPES = {"VARCHAR": pa.string(), "INTEGER": pa.int32(), "VARCHAR[]": pa.list_(pa.string())}
_ARTICLE_SCHEMA = pa.schema([(c, _ARROW_TYPES[t.split()[0]]) for c, t in ARTICLE_COLUMNS.items()])
_ROLE_SCHEMA = pa.schema([("pmcid", pa.string()), ("author_position", pa.int32()), ("role", pa.string())])

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
    retries INTEGER, finished BOOLEAN NOT NULL DEFAULT false, error VARCHAR
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
    SELECT CASE WHEN grouping(a.publisher) = 1 THEN '(all)' ELSE coalesce(a.publisher, '(no publisher)') END
               AS publisher, count(DISTINCT pmcid) AS articles,
           count(*) FILTER (tagged AND parsed) AS hits, count(*) FILTER (parsed) AS parsed,
           count(*) FILTER (tagged) AS tagged
    FROM pairs JOIN articles a USING (pmcid) GROUP BY ROLLUP (a.publisher)
)
SELECT publisher, articles, round(hits / nullif(parsed, 0), 3) AS precision,
       round(hits / nullif(tagged, 0), 3) AS recall, round(2 * hits / nullif(parsed + tagged, 0), 3) AS f1
FROM counts;
"""

SCHEMA_VERSION = hashlib.sha256(f"{SCHEMA}{_ARTICLE_SCHEMA}{_ROLE_SCHEMA}".encode()).hexdigest()[:12]
"""Changes with any edit to the tables, so a database never gets rows its tables were not made for."""

_PARSER_FILES = ("roles.py", "statement.py", "jats.py", "rows.py")
PARSER_VERSION = hashlib.sha256(
    b"".join((Path(__file__).parent / name).read_bytes() for name in _PARSER_FILES)
).hexdigest()[:12]
"""Changes whenever the code that turns XML into rows changes, so one database never mixes parsers."""


class Unit(TypedDict):
    """A unit's record in the units table, as a source's `read` returns it."""

    unit: str
    articles: int
    retries: int
    """Articles (or, for a bulk file, the file) left for the next run because a download failed."""
    finished: bool
    listed_date: NotRequired[str | None]
    size: NotRequired[int]
    sha256: NotRequired[str]
    error: NotRequired[str]
    """Why an unfinished unit failed."""


class PinMismatch(Exception):
    """The database was built by other parser or schema code."""


def connect(db: Path, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Open `db` after checking its pins: a writer refuses a database built by other code (PinMismatch),
    a reader prints a one-line warning, and a writer pins this code's versions into a new database."""
    if read_only:
        con = duckdb.connect(str(db), read_only=True)
    else:
        db.parent.mkdir(parents=True, exist_ok=True)
        con = duckdb.connect(str(db))
        con.execute(SCHEMA)
    if mismatches := mismatched_pins(con):
        message = f"{db} was built by other code ({'; '.join(mismatches)})"
        if not read_only:
            con.close()
            raise PinMismatch(f"{message}; rerun with --fresh")
        print(f"warning: {message}; its rows may not match this code", file=sys.stderr)
    elif not read_only:
        pin(con, "schema", SCHEMA_VERSION)
        pin(con, "parser", PARSER_VERSION)
    return con


def one(con: duckdb.DuckDBPyConnection, query: str, params: object = None) -> tuple | None:
    """The first row of a query that returns at most one, or None. Reads the whole result: from
    duckdb 2.0 a half-read `fetchone()` result blocks `con.sql()` and `con.register()` until closed."""
    rows = con.execute(query, params).fetchall()
    return rows[0] if rows else None


def pin(con: duckdb.DuckDBPyConnection, key: str, value: str) -> str:
    """The value `key` was first pinned to in this database, pinning it to `value` if unset."""
    con.execute("INSERT INTO meta VALUES (?, ?) ON CONFLICT DO NOTHING", [key, value])
    (pinned,) = one(con, "SELECT value FROM meta WHERE key = ?", [key]) or (value,)
    return pinned


def mismatched_pins(con: duckdb.DuckDBPyConnection) -> list[str]:
    """Pins this code disagrees with: rows from another parser or schema must not be mixed in."""
    try:
        pinned = dict(con.execute("SELECT key, value FROM meta").fetchall())
        (rows,) = one(con, "SELECT count(*) FROM articles") or (0,)
    except duckdb.CatalogException:
        return ["no census tables"]
    if rows and "parser" not in pinned:
        return ["rows from code that pinned no parser version"]
    expected = {"schema": SCHEMA_VERSION, "parser": PARSER_VERSION}
    return [f"{k} {pinned[k]} (this code: {v})" for k, v in expected.items() if pinned.get(k, v) != v]


# Errors from a value DuckDB or Arrow rejects. Anything else (a full disk, out of memory) propagates,
# so the unit stays unrecorded and is read again.
_VALUE_ERRORS = (
    pa.ArrowException,
    duckdb.ConversionException,
    duckdb.ConstraintException,
    duckdb.InvalidInputException,
)


def insert(con: duckdb.DuckDBPyConnection, batch: list[Rows], unit: Unit | None = None) -> None:
    """Write a batch, and the record of the unit it came from, in one transaction, so an interrupted
    run never leaves half an article or a unit marked finished without its rows.

    If DuckDB rejects the batch, each article is written on its own and a rejected one is stored as
    an error row, so one bad value does not stop the run on every resume. Those single writes always
    replace, so an article already stored (by another unit, or twice in this batch) cannot fail them.
    """
    try:
        _write(con, batch, unit)
    except _VALUE_ERRORS:
        for i, rows in enumerate(batch):
            last = unit if i == len(batch) - 1 else None
            try:
                _write(con, [rows], last, replace=True)
            except _VALUE_ERRORS as error:
                a = rows.article
                failed = failed_row(str(a["pmcid"]), str(a["stratum"]), "error", f"insert: {error}")
                _write(con, [failed], last, replace=True)


def _write(con: duckdb.DuckDBPyConnection, batch: list[Rows], unit: Unit | None = None, replace: bool = False) -> None:
    con.begin()
    try:
        # Re-reading a unit replaces its articles' rows. A unit never recorded has none to replace, so
        # the delete is skipped; a duplicate that slips in fails the batch and `insert` retries it with replace.
        if replace or unit is None or one(con, "SELECT 1 FROM units WHERE unit = ?", [unit["unit"]]):
            ids = [r.article["pmcid"] for r in batch]
            for table in ("assignments", "paired", "articles"):
                con.execute(f"DELETE FROM {table} WHERE pmcid IN (SELECT unnest(?))", [ids])
        _insert(con, "articles", _ARTICLE_SCHEMA, [[r.article.get(c) for c in ARTICLE_COLUMNS] for r in batch])
        _insert(con, "assignments", _ROLE_SCHEMA, [[r.article["pmcid"], p, role] for r in batch for p, role in r.roles])
        _insert(con, "paired", _ROLE_SCHEMA, [[r.article["pmcid"], p, role] for r in batch for p, role in r.paired])
        if unit is not None:
            con.execute(
                "INSERT OR REPLACE INTO units BY NAME SELECT * FROM (SELECT ? AS unit, ? AS listed_date, ? AS size,"
                " ? AS sha256, ? AS articles, ? AS retries, ? AS finished, ? AS error)",
                [
                    unit.get(k)
                    for k in ("unit", "listed_date", "size", "sha256", "articles", "retries", "finished", "error")
                ],
            )
        con.commit()
    except duckdb.Error, pa.ArrowException:
        con.rollback()
        raise


def _insert(con: duckdb.DuckDBPyConnection, table: str, schema: pa.Schema, rows: list[list]) -> None:
    """Hand DuckDB whole columns as an Arrow table: binding every value as a SQL parameter made the
    single writing process the bottleneck of a run."""
    if not rows:
        return
    columns = [pa.array(values, type=f.type) for values, f in zip(zip(*rows, strict=True), schema, strict=True)]
    con.register("_batch", pa.Table.from_arrays(columns, schema=schema))
    # No finally: after a failed insert duckdb 2.0 refuses unregister in the aborted transaction, and
    # the caller's rollback drops the view anyway.
    con.execute(f"INSERT INTO {table} BY NAME SELECT * FROM _batch")
    con.unregister("_batch")
