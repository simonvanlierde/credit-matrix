"""The public dataset: role facts and ORCIDs under CC0, statement text only from CC BY and CC0 articles.

Author names and other statement text stay in the local database.
"""

import json
from pathlib import Path

import duckdb

# CC BY (any version, no NC/ND/SA terms) and CC0, as a licence URL or as text.
OPEN_LICENCE = (
    r"(?i)creativecommons\.org/licenses/by/|creativecommons\.org/publicdomain/zero/|^\s*cc[ -]?by\s*\d|^\s*cc0\b"
)

README = """# CRediT census: {name}

Per-author CRediT roles read from open-access articles by the CRediT census
(https://github.com/simonvanlierde/credit-matrix, census/). Counts and provenance are in meta.json.

- articles.parquet: one row per article (PMCID, DOI, year, publisher, journal, field, article type,
  markup style, author counts, licence). CC0.
- assignments.parquet: one row per author and role (PMCID, author position from 1, role slug from
  credit.niso.org, ORCID when the article gives one). CC0.
- statements.parquet: the contribution text roles were read from, only for articles under CC BY or
  CC0, with each article's licence. Each row keeps its source licence; cite the article by its PMCID.

No author names are included; PMCID and DOI lead to them at the source.
"""


def export(con: duckdb.DuckDBPyConnection, out: Path, name: str) -> dict[str, int]:
    """Write the dataset to `out` and return its row counts."""
    out.mkdir(parents=True, exist_ok=True)
    has_fields = con.execute("SELECT count(*) FROM duckdb_views() WHERE view_name = 'article_fields'").fetchone()
    field = "f.field, f.domain" if has_fields and has_fields[0] else "NULL AS field, NULL AS domain"
    join = "LEFT JOIN article_fields f USING (pmcid)" if has_fields and has_fields[0] else ""
    queries = {
        "articles": f"""
            SELECT a.pmcid, a.doi, a.year, a.publisher, a.journal, {field}, a.article_type, a.style,
                   a.n_authors, a.n_authors_with_roles, a.license
            FROM articles a {join} WHERE a.style NOT IN ('error', 'missing') ORDER BY a.pmcid""",
        "assignments": """
            SELECT s.pmcid, s.author_position, s.role, a.orcids[s.author_position] AS orcid
            FROM assignments s JOIN articles a USING (pmcid) ORDER BY ALL""",
        "statements": f"""
            SELECT pmcid, license, statement FROM articles
            WHERE statement IS NOT NULL AND regexp_matches(coalesce(license, ''), '{OPEN_LICENCE}')
            ORDER BY pmcid""",
    }
    counts = {}
    for table, query in queries.items():
        path = out / f"{table}.parquet"
        con.execute(f"COPY ({query}) TO '{path}' (FORMAT parquet)")
        (counts[table],) = con.execute(f"SELECT count(*) FROM read_parquet('{path}')").fetchone() or (0,)
    meta = dict(con.execute("SELECT key, value FROM meta ORDER BY key").fetchall())
    # One digest over every finished unit's file hash: names the exact bulk files the data came from.
    (units, digest) = con.execute(
        "SELECT count(*), sha256(string_agg(unit || ' ' || sha256, '\n' ORDER BY unit)) FROM units"
        " WHERE finished AND sha256 IS NOT NULL"
    ).fetchone() or (0, None)
    if units:
        meta |= {"files": str(units), "files_digest": digest}
    (out / "meta.json").write_text(json.dumps({"name": name, "counts": counts, "provenance": meta}, indent=2) + "\n")
    (out / "README.md").write_text(README.format(name=name))
    return counts
