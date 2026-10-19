"""Counts for the public census page: totals per year, field, publisher, style and role, never rows.

Research articles only, as in `census report`: corrections, editorials and the like carry no statement.
"""

import json
from pathlib import Path

import duckdb

from census.export import DATASET_VERSION, commit
from census.fields import has_fields

MIN_ARTICLES = 1000
"""A year, field or style with fewer research articles than this is left out: its share is noise. The year
series also starts at the first year with this many articles with roles, which keeps out the few free-text
matches from before CRediT existed."""
TOP_PUBLISHERS = 20

_RESEARCH = "a.article_type = 'research-article' AND a.style NOT IN ('error', 'missing', 'retry')"

QUERIES = {
    "years": f"""
        SELECT a.year, count(*) AS articles, count(*) FILTER (a.n_authors_with_roles > 0) AS with_roles,
               round(sum(r.n) / nullif(sum(a.n_authors_with_roles), 0), 2) AS roles_per_author
        FROM articles a LEFT JOIN (SELECT pmcid, count(*) AS n FROM assignments GROUP BY pmcid) r USING (pmcid)
        WHERE {_RESEARCH} AND a.year IS NOT NULL GROUP BY a.year HAVING count(*) >= $min ORDER BY a.year""",
    "styles": f"""
        SELECT a.year, a.style, count(*) AS articles FROM articles a
        WHERE {_RESEARCH} AND a.year IS NOT NULL AND a.style <> 'none' GROUP BY ALL ORDER BY a.year, a.style""",
    "fields": f"""
        SELECT f.field, count(*) AS articles, count(*) FILTER (a.n_authors_with_roles > 0) AS with_roles
        FROM articles a JOIN article_fields f USING (pmcid)
        WHERE {_RESEARCH} AND a.year = $year AND f.field IS NOT NULL
        GROUP BY ALL HAVING count(*) >= $min ORDER BY f.field""",
    "publishers": f"""
        SELECT a.publisher, count(*) AS articles, count(*) FILTER (a.n_authors_with_roles > 0) AS with_roles
        FROM articles a WHERE {_RESEARCH} AND a.year = $year AND a.publisher IS NOT NULL
        GROUP BY ALL ORDER BY articles DESC, a.publisher LIMIT {TOP_PUBLISHERS}""",
    # Share of the authors with at least one role, in each byline place, who hold each role. Articles with
    # roles and three or more authors only, so first, middle and last are distinct people.
    "roles": f"""
        WITH authors AS (
            SELECT a.pmcid, p.position,
                   CASE WHEN p.position = 1 THEN 'first' WHEN p.position = a.n_authors THEN 'last' ELSE 'middle'
                   END AS place
            FROM articles a, range(1, a.n_authors + 1) p(position)
            WHERE {_RESEARCH} AND a.n_authors_with_roles > 0 AND a.n_authors > 2
        ),
        held AS (
            SELECT r.role, au.pmcid, au.position, au.place FROM authors au
            JOIN assignments r ON r.pmcid = au.pmcid AND r.author_position = au.position
        ),
        counts AS (
            SELECT role, coalesce(place, 'all') AS place, count(*) AS n FROM held
            GROUP BY GROUPING SETS ((role, place), (role))
        ),
        totals AS (
            SELECT coalesce(place, 'all') AS place, count(*) AS n
            FROM (SELECT DISTINCT pmcid, position, place FROM held) GROUP BY ROLLUP (place)
        )
        SELECT c.role, c.place, round(c.n / t.n, 4) AS share FROM counts c JOIN totals t USING (place)
        ORDER BY c.role, c.place""",
}


def aggregate(
    con: duckdb.DuckDBPyConnection, out: Path, name: str, partial: bool = False, min_articles: int = MIN_ARTICLES
) -> int:
    """Write the page's counts to `out` as JSON and return its size in bytes.

    Refuses a database with unfinished units or no fields unless `partial`, like `census export`.
    """
    (units_total, units_finished) = con.execute(
        "SELECT count(*), count(*) FILTER (finished) FROM units"
    ).fetchone() or (0, 0)
    fielded = has_fields(con)
    complete = bool(units_total) and units_total == units_finished and fielded
    if not complete and not partial:
        raise ValueError(
            f"{units_finished}/{units_total} units finished, fields {'built' if fielded else 'missing'}:"
            " finish the run and `census fields`, or aggregate with --partial"
        )
    meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
    # The newest year is still being published, so per-field and per-publisher shares use the one before.
    # Newest by volume, not max(year): a few articles dated ahead must not move it.
    (newest,) = con.execute(
        f"SELECT max(year) FROM (SELECT a.year FROM articles a WHERE {_RESEARCH} GROUP BY a.year"
        " HAVING count(*) >= $min)",
        {"min": min_articles},
    ).fetchone() or (None,)
    year = newest - 1 if newest else None

    def rows(key: str) -> list[dict]:
        if key == "fields" and not fielded:
            return []
        params = {k: v for k, v in {"year": year, "min": min_articles}.items() if f"${k}" in QUERIES[key]}
        rel = con.execute(QUERIES[key], params)
        columns = [d[0] for d in rel.description]
        return [dict(zip(columns, row, strict=True)) for row in rel.fetchall()]

    (articles,) = con.execute(
        "SELECT count(*) FROM articles WHERE style NOT IN ('error', 'missing', 'retry')"
    ).fetchone() or (0,)
    paired = con.execute("SELECT articles, f1 FROM paired_scores WHERE publisher = '(all)'").fetchone()
    # The paired score rests mostly on these two publishers, whose tags are themselves unchecked.
    (mdpi_frontiers,) = con.execute(
        "SELECT coalesce(sum(articles), 0) FROM paired_scores"
        " WHERE publisher LIKE '%(MDPI)%' OR publisher LIKE 'Frontiers %'"
    ).fetchone() or (0,)
    data = {
        "snapshot": name,
        "dataset_version": DATASET_VERSION,
        "code_commit": commit(),
        "openalex_sources": meta.get("openalex_sources"),
        "parser": meta.get("parser"),
        "complete": complete,
        "articles": articles,
        "focus_year": year,
        "paired": {"articles": paired[0], "f1": paired[1], "mdpi_frontiers_share": round(mdpi_frontiers / paired[0], 3)}
        if paired and paired[0]
        else None,
        **{key: rows(key) for key in QUERIES},
    }
    first = min((row["year"] for row in data["years"] if row["with_roles"] >= min_articles), default=None)
    data["years"] = [row for row in data["years"] if first is not None and row["year"] >= first]
    years = {row["year"] for row in data["years"]}
    data["styles"] = [row for row in data["styles"] if row["year"] in years]
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n"
    out.write_text(text, encoding="utf-8")
    return len(text.encode())
