"""Field norms for the app: how often each CRediT role is given, per field and author position.

Shares only, with article and author counts: no names, no per-article rows. The app shows them as
context while a lead fills the grid, never as a suggestion.
"""

import json
from pathlib import Path

import duckdb

from census import store
from census.export import DATASET_VERSION, commit
from census.fields import has_fields

MIN_ARTICLES = 1000
"""A field with fewer research articles with roles is left out: its single-author shares would rest on
a handful of papers."""
MIN_AUTHORS = 50
"""A position with fewer authors in a field gets no shares (null): at 50 a share is within about 14
points either way (95%), at fewer it says little."""
POSITIONS = ("single", "first", "middle", "last")
# CRediT order, as the app lists them.
ROLES = (
    "conceptualization",
    "data-curation",
    "formal-analysis",
    "funding-acquisition",
    "investigation",
    "methodology",
    "project-administration",
    "resources",
    "software",
    "supervision",
    "validation",
    "visualization",
    "writing-original-draft",
    "writing-review-editing",
)

# Research articles with roles and a field, for both the article count and the shares.
ARTICLES = """articles a JOIN article_fields f USING (pmcid)
    WHERE a.article_type = 'research-article' AND a.n_authors_with_roles > 0 AND f.field IS NOT NULL"""
# The denominator is authors with at least one role: an author the parser gave no role (unresolved
# initials) would otherwise count as holding none.
QUERY = """
WITH arts AS (
    SELECT a.pmcid, a.n_authors, f.field FROM {articles}
),
authors AS (
    SELECT s.pmcid, s.author_position, list(s.role) AS roles, any_value(arts.field) AS field,
           CASE WHEN any_value(arts.n_authors) = 1 THEN 'single' WHEN s.author_position = 1 THEN 'first'
                WHEN s.author_position = any_value(arts.n_authors) THEN 'last' ELSE 'middle' END AS position
    FROM assignments s JOIN arts USING (pmcid)
    GROUP BY s.pmcid, s.author_position
)
SELECT field, position, count(*) AS authors,
       {roles}
FROM authors GROUP BY field, position
"""


def build(con: duckdb.DuckDBPyConnection, snapshot: str, min_articles: int = MIN_ARTICLES) -> dict:
    """The norms as one JSON-ready dict. Raises ValueError on a database without fields."""
    if not has_fields(con):
        raise ValueError("no fields in this database; run `census fields` first")
    articles = dict(
        con.execute(
            f"SELECT f.field, count(*) FROM {ARTICLES} GROUP BY f.field HAVING count(*) >= ?",
            [min_articles],
        ).fetchall()
    )
    roles = ", ".join(f"count(*) FILTER (list_contains(roles, '{role}')) AS \"{role}\"" for role in ROLES)
    fields: dict[str, dict] = {
        name: {"articles": n, "authors": dict.fromkeys(POSITIONS, 0), "shares": dict.fromkeys(POSITIONS)}
        for name, n in sorted(articles.items(), key=lambda kv: -kv[1])
    }
    for field, position, authors, *counts in con.execute(QUERY.format(articles=ARTICLES, roles=roles)).fetchall():
        if field not in fields:
            continue
        fields[field]["authors"][position] = authors
        if authors >= MIN_AUTHORS:
            fields[field]["shares"][position] = [round(n / authors, 3) for n in counts]
    meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
    (files_date,) = store.one(con, "SELECT max(listed_date) FROM units WHERE finished") or (None,)
    # The parser against publisher tags over every tagged article: the `(all)` row `census report` prints.
    paired = store.one(con, "SELECT f1, articles FROM paired_scores WHERE publisher = '(all)'")
    f1, f1_articles = paired or (None, 0)
    return {
        "snapshot": snapshot,
        "dataset_version": DATASET_VERSION,
        "code_commit": commit(),
        "files_date": files_date and files_date[:10],
        "openalex_sources": meta.get("openalex_sources"),
        "parser_f1": f1,
        "parser_f1_articles": f1_articles,
        "min_articles": min_articles,
        "min_authors": MIN_AUTHORS,
        "positions": list(POSITIONS),
        "roles": list(ROLES),
        "fields": fields,
    }


def write(norms: dict, out: Path) -> int:
    """Write compact JSON and return its size in bytes."""
    text = json.dumps(norms, separators=(",", ":"), ensure_ascii=False) + "\n"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    return len(text.encode())
