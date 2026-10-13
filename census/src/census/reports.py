"""The summary tables `census report` prints. Research articles only: corrections, editorials and the
like carry no statement."""

REPORTS = {
    "Markup style per publisher stratum": """
        SELECT stratum, style, count(*) AS articles,
               round(avg(n_authors_with_roles / nullif(n_authors, 0)), 3) AS author_coverage
        FROM articles WHERE article_type = 'research-article' GROUP BY ALL ORDER BY stratum, articles DESC""",
    "Articles with roles, per year": """
        SELECT year, count(*) AS articles, round(avg((n_authors_with_roles > 0)::INT), 3) AS with_roles
        FROM articles WHERE article_type = 'research-article' AND year IS NOT NULL GROUP BY year ORDER BY year""",
    "Share of authors holding each role, by author position": """
        WITH authors AS (
            SELECT a.pmcid, p.position,
                   CASE WHEN p.position = 1 THEN 'first' WHEN p.position = a.n_authors THEN 'last' ELSE 'middle'
                   END AS place
            FROM articles a, range(1, a.n_authors + 1) p(position)
            WHERE a.n_authors_with_roles > 0 AND a.n_authors > 2 AND a.article_type = 'research-article'
        )
        PIVOT (
            SELECT r.role, au.place, count(*) / any_value(t.n) AS share
            FROM authors au
            JOIN assignments r ON r.pmcid = au.pmcid AND r.author_position = au.position
            JOIN (SELECT place, count(*) AS n FROM authors GROUP BY place) t USING (place)
            GROUP BY r.role, au.place
        ) ON place IN ('first', 'middle', 'last') USING round(any_value(share), 3) ORDER BY role""",
    "Statement parser scored against the tags of articles that have both": """
        SELECT * FROM paired_scores WHERE articles >= 5 OR publisher = '(all)' ORDER BY articles DESC""",
    "Articles with roles, per field": """
        SELECT f.field, count(*) AS articles, round(avg((a.n_authors_with_roles > 0)::INT), 3) AS with_roles
        FROM articles a JOIN article_fields f USING (pmcid)
        WHERE a.article_type = 'research-article' GROUP BY ALL ORDER BY articles DESC LIMIT 30""",
}
