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
}


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "o.duckdb"
    con = store.connect(path)
    unit: store.Unit = {"unit": "u1", "sha256": "ab", "articles": len(XML), "retries": 0, "finished": True}
    store.insert(con, [store.rows_for(pmcid, "all", xml) for pmcid, xml in XML.items()], unit)
    con.execute("UPDATE articles SET article_type = 'research-article'")
    con.close()
    return path


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
    # Four roles over the three authors with roles in PMC1.
    assert data["years"] == [{"year": 2024, "articles": 2, "with_roles": 1, "roles_per_author": 1.33}]
    assert data["styles"] == [{"year": 2024, "style": "contrib_text", "articles": 1}]
    assert data["publishers"] == []  # the newest year is 2024, so the focus year 2023 has no articles
    shares = {(r["role"], r["place"]): r["share"] for r in data["roles"]}
    # PMC1 has three authors: software for the first and last, validation for the middle one.
    assert shares[("software", "all")] == 0.6667
    assert shares[("software", "first")] == 1.0
    assert shares[("validation", "middle")] == 1.0
    assert ("validation", "first") not in shares


def test_aggregate_command_refuses_incomplete(db, tmp_path, capsys):
    out = tmp_path / "census.json"
    assert cli.main(["aggregate", "--db", str(db), "--out", str(out)]) == 1
    assert "--partial" in capsys.readouterr().err
    assert cli.main(["aggregate", "--db", str(db), "--out", str(out), "--partial"]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["years"] == []  # under the size floor
