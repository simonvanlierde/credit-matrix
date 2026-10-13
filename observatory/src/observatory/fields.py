"""A research field per journal, from the topic counts in OpenAlex's sources snapshot.

OpenAlex has no free bulk route to topics per article (its API allows 1,000 requests a day without a
key), so fields are per journal: the field holding the largest share of the journal's topic counts.
OpenAlex lists only a journal's top topics, which inflates that share, so the cutoff for
"multidisciplinary" sits high: PLOS ONE (0.31) and Scientific Reports (0.44) fall under it, Nature
Communications (0.57) and BMJ Open (0.58) do not.

Articles match a journal by ISSN, or else by journal title when only one journal has that title:
Europe PMC's copy of the JATS often leaves the ISSN out.
"""

import duckdb

OPENALEX_SOURCES = "s3://openalex/data/parquet/sources/*/*.parquet"
MULTIDISCIPLINARY = 0.45


def build_journals(con: duckdb.DuckDBPyConnection, sources: str = OPENALEX_SOURCES) -> int:
    """Create the journals and journal_keys tables and the article_fields view. Returns the journal count."""
    if sources.startswith("s3://"):
        con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region = 'us-east-1'")
    con.execute("SET enable_progress_bar = false")
    con.execute(
        "CREATE OR REPLACE TEMP TABLE sources AS SELECT * FROM read_parquet(?, union_by_name = true)", [sources]
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE journals AS
        WITH by_field AS (
            SELECT id, any_value(display_name) AS journal, t.field.display_name AS field,
                   any_value(t.domain.display_name) AS domain, sum(t.count) AS n
            FROM (SELECT id, display_name, unnest(topics) AS t FROM sources WHERE len(topics) > 0)
            GROUP BY id, field
        ),
        ranked AS (
            SELECT *, n / sum(n) OVER (PARTITION BY id) AS field_share,
                   row_number() OVER (PARTITION BY id ORDER BY n DESC, field) AS rank
            FROM by_field
        )
        SELECT id AS openalex_id, journal, field, domain, round(field_share, 3) AS field_share
        FROM ranked WHERE rank = 1
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE journal_keys AS
        WITH keys AS (
            SELECT id, 'issn:' || unnest(issn) AS key FROM sources WHERE issn IS NOT NULL
            UNION
            SELECT id, 'title:' || lower(unnest(list_prepend(display_name, coalesce(alternate_titles, []))))
            FROM sources
        )
        SELECT key, any_value(id) AS openalex_id FROM keys
        WHERE id IN (SELECT openalex_id FROM journals)
        GROUP BY key HAVING count(DISTINCT id) = 1
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE VIEW article_fields AS
        WITH keys AS (
            SELECT pmcid, 'issn:' || unnest(issn) AS key, 1 AS preference FROM articles
            UNION ALL
            SELECT pmcid, 'title:' || lower(journal), 2 FROM articles WHERE journal IS NOT NULL
        ),
        matched AS (
            SELECT k.pmcid, arg_min(j.openalex_id, k.preference) AS openalex_id
            FROM keys k JOIN journal_keys j USING (key) GROUP BY k.pmcid
        )
        SELECT a.pmcid, j.openalex_id,
               CASE WHEN j.field_share < {MULTIDISCIPLINARY} THEN 'Multidisciplinary' ELSE j.field END AS field,
               CASE WHEN j.field_share < {MULTIDISCIPLINARY} THEN 'Multidisciplinary' ELSE j.domain END AS domain
        FROM articles a LEFT JOIN matched m USING (pmcid) LEFT JOIN journals j USING (openalex_id)
        """
    )
    (count,) = con.execute("SELECT count(*) FROM journals").fetchone() or (0,)
    return count
