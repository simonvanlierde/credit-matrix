import json

import pytest
from helpers import article, contrib

from census import aggregate, cli, store

XML = {
    "PMC1": article(
        contrib("Ann", "Smith", "<role>Software</role>")
        + contrib("Bo", "Jones", "<role>Validation</role>")
        + contrib("Cy", "Berg", "<role>Software</role><role>Supervision</role>")
    ),
    "PMC2": article(contrib("Ann", "Smith") + contrib("Bo", "Jones") + contrib("Cy", "Berg")),
    # The middle author holds no role, so does not count towards any share.
    "PMC3": article(
        contrib("Di", "Ma", "<role>Software</role>")
        + contrib("Ed", "Ng")
        + contrib("Fa", "Oz", "<role>Validation</role>")
    ),
    # Two authors: the first is also the last, so the article stays out of the byline table.
    "PMC4": article(
        contrib("Gu", "Po", "<role>Conceptualization</role>") + contrib("Ha", "Qi", "<role>Software</role>")
    ),
    # A single article dated ahead of the snapshot, which must not move the focus year.
    "PMC5": article(contrib("Io", "Ra")),
}
YEARS = {"PMC1": 2023, "PMC2": 2023, "PMC3": 2024, "PMC4": 2024, "PMC5": 2025}


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "o.duckdb"
    con = store.connect(path)
    unit: store.Unit = {"unit": "u1", "sha256": "ab", "articles": len(XML), "retries": 0, "finished": True}
    store.insert(con, [store.rows_for(pmcid, "all", xml) for pmcid, xml in XML.items()], unit)
    con.execute("UPDATE articles SET article_type = 'research-article'")
    con.executemany("UPDATE articles SET year = ? WHERE pmcid = ?", [[y, p] for p, y in YEARS.items()])
    con.close()
    return path


def with_fields(db):
    """Stand in for `census fields`: the view the fields query and the completeness check read."""
    con = store.connect(db)
    con.execute(
        "CREATE VIEW article_fields AS SELECT * FROM (VALUES ('PMC1', 'Medicine'), ('PMC2', 'Medicine'),"
        " ('PMC3', 'Physics')) t(pmcid, field)"
    )
    con.close()


def run(db, out, **kwargs) -> dict:
    with store.connect(db, read_only=True) as con:
        aggregate.aggregate(con, out, "t", partial=True, **kwargs)
    return json.loads(out.read_text(encoding="utf-8"))


def test_aggregate_counts_without_names(db, tmp_path):
    out = tmp_path / "census.json"
    with store.connect(db, read_only=True) as con:
        with pytest.raises(ValueError, match="fields missing"):
            aggregate.aggregate(con, out, "t")
        # Every group here is under the default size floor.
        size = aggregate.aggregate(con, out, "t", partial=True, min_articles=1)
    text = out.read_text(encoding="utf-8")
    assert size == len(text.encode())
    assert "Smith" not in text and "PMC1" not in text
    data = json.loads(text)
    assert data["snapshot"] == "t" and data["complete"] is False and data["fields"] == []
    assert {"dataset_version", "code_commit", "openalex_sources"} <= data.keys()
    assert [row["year"] for row in data["years"]] == [2023, 2024, 2025]
    # Four roles over the three authors with roles in PMC1.
    assert data["years"][0] == {"year": 2023, "articles": 2, "with_roles": 1, "roles_per_author": 1.33}
    assert data["styles"][0] == {"year": 2023, "style": "contrib_text", "articles": 1}
    shares = {(r["role"], r["place"]): r["share"] for r in data["roles"]}
    # Five authors with roles in PMC1 and PMC3; PMC3's roleless middle author is not among them.
    assert shares[("software", "all")] == 0.6
    assert shares[("validation", "all")] == 0.4
    assert shares[("software", "first")] == 1.0
    assert shares[("validation", "middle")] == 1.0
    assert shares[("software", "last")] == shares[("validation", "last")] == shares[("supervision", "last")] == 0.5
    assert ("validation", "first") not in shares
    assert ("conceptualization", "all") not in shares  # PMC4 has two authors


def test_aggregate_fields_publishers_and_floors(db, tmp_path):
    with_fields(db)
    data = run(db, tmp_path / "census.json", min_articles=2)
    assert data["complete"] is True
    # 2025 holds one article, under the floor, so 2024 is the newest year and 2023 the focus year.
    assert data["focus_year"] == 2023
    # 2023 has one article with roles, under the floor, so the series starts in 2024.
    assert [row["year"] for row in data["years"]] == [2024]
    assert {row["year"] for row in data["styles"]} == {2024}
    assert data["fields"] == [{"field": "Medicine", "articles": 2, "with_roles": 1}]
    assert data["publishers"] == [{"publisher": "Test Press", "articles": 2, "with_roles": 1}]
    assert data["paired"] is None  # no article both tags its roles and prints a statement


def test_aggregate_command_refuses_incomplete(db, tmp_path, capsys):
    out = tmp_path / "census.json"
    assert cli.main(["aggregate", "--db", str(db), "--out", str(out)]) == 1
    assert "--partial" in capsys.readouterr().err
    assert cli.main(["aggregate", "--db", str(db), "--out", str(out), "--partial"]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["years"] == []  # under the size floor
