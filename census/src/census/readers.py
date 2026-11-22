"""Who read each article's roles, and the one definition of the census's roles.

Tagged articles (`jats4r`, `plos_uri`) keep their publisher tags and `contrib_text` articles the rule
parser's per-author pairs. Every other free-text statement, CRediT-worded (`statement_text`) or
narrative (style `none` with a statement), takes the pairs of a fine-tuned encoder, loaded by
`apply_encoder`. Without an applied run, `statement_text` falls back to the rules' pairs and a
narrative statement has no roles.

Reports, the export, the page's counts and the norms read `census_roles` and `census_articles`, never
`assignments` or `articles.n_authors_with_roles`, which hold the parser's reading only.
"""

import duckdb

from census import store

TAGGED = "'jats4r', 'plos_uri'"
ENCODER_READS = "style IN ('statement_text', 'none') AND statement IS NOT NULL"
"""The articles whose roles come from the encoder: it reads the statement's words, which `contrib_text`
(positions and role lists) is not."""


def apply_encoder(con: duckdb.DuckDBPyConnection, parts: str, name: str) -> tuple[int, int]:
    """Replace `encoder_assignments` with the encoder's Parquet parts (a glob) and record `name` in
    `meta` as `encoder`. Returns (articles, pairs). Refuses parts that miss an article the encoder is
    to read, and leaves the database as it was."""
    con.begin()
    try:
        con.execute(
            "CREATE OR REPLACE TABLE encoder_assignments AS SELECT pmcid, author_position, role"
            f" FROM read_parquet(?) WHERE pmcid IN (SELECT pmcid FROM articles WHERE {ENCODER_READS})",
            [parts],
        )
        (expected,) = store.one(con, f"SELECT count(*) FROM articles WHERE {ENCODER_READS}") or (0,)
        (articles, pairs) = store.one(con, "SELECT count(DISTINCT pmcid), count(role) FROM encoder_assignments") or (
            0,
            0,
        )
        if articles < expected:
            raise ValueError(f"{parts} read {articles} of the {expected} statements the encoder is to read")
        con.execute("INSERT OR REPLACE INTO meta VALUES ('encoder', ?)", [name])
        con.commit()
    except BaseException:
        con.rollback()
        raise
    return articles, pairs


def use_roles(con: duckdb.DuckDBPyConnection) -> None:
    """Create the temporary views `census_roles` (pmcid, author_position, role) and `census_articles`
    (`articles` with `n_authors_with_roles` counted from them, and `reader`: `tags`, `rules`, `encoder`,
    or null when nothing read the article's roles)."""
    (applied,) = store.one(con, "SELECT count(*) FROM duckdb_tables() WHERE table_name = 'encoder_assignments'") or (0,)
    if not applied:
        con.execute(
            "CREATE OR REPLACE TEMP TABLE encoder_assignments (pmcid VARCHAR, author_position INTEGER, role VARCHAR)"
        )
    con.execute(
        f"""
        CREATE OR REPLACE TEMP VIEW census_roles AS
        SELECT s.pmcid, s.author_position, s.role FROM assignments s JOIN articles a USING (pmcid)
        WHERE a.style IN ({TAGGED}, 'contrib_text') OR s.pmcid NOT IN (SELECT pmcid FROM encoder_assignments)
        UNION ALL
        SELECT e.pmcid, e.author_position, e.role FROM encoder_assignments e JOIN articles a USING (pmcid)
        WHERE e.role IS NOT NULL AND a.{ENCODER_READS} AND e.author_position BETWEEN 1 AND a.n_authors"""
    )
    con.execute(
        f"""
        CREATE OR REPLACE TEMP VIEW census_articles AS
        SELECT a.* REPLACE (
                   CASE WHEN a.n_authors_with_roles IS NULL THEN NULL ELSE coalesce(n.n, 0)::INTEGER END
                   AS n_authors_with_roles),
               CASE WHEN a.style IN ({TAGGED}) THEN 'tags'
                    WHEN a.style = 'contrib_text' THEN 'rules'
                    WHEN a.pmcid IN (SELECT pmcid FROM encoder_assignments) AND a.{ENCODER_READS} THEN 'encoder'
                    WHEN a.style = 'statement_text' THEN 'rules' END AS reader
        FROM articles a LEFT JOIN (
            SELECT pmcid, count(DISTINCT author_position) AS n FROM census_roles GROUP BY pmcid
        ) n USING (pmcid)"""
    )
