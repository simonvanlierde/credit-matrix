import json

import pytest

from census import cli, norms, store


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "n.duckdb"
    con = store.connect(path)
    # P1: three authors in Ecology. P2: a single author in Ecology. P3: an editorial, P4: no field.
    con.execute(
        """INSERT INTO articles (pmcid, article_type, n_authors, n_authors_with_roles, style) VALUES
           ('P1', 'research-article', 3, 3, 'jats4r'), ('P2', 'research-article', 1, 1, 'jats4r'),
           ('P3', 'editorial', 2, 2, 'jats4r'), ('P4', 'research-article', 2, 2, 'jats4r'),
           ('P5', 'research-article', 2, 0, 'none')"""
    )
    con.execute(
        """INSERT INTO assignments VALUES
           ('P1', 1, 'conceptualization'), ('P1', 1, 'writing-original-draft'), ('P1', 2, 'investigation'),
           ('P1', 3, 'supervision'), ('P1', 3, 'conceptualization'), ('P2', 1, 'software'),
           ('P3', 1, 'software'), ('P4', 1, 'software')"""
    )
    con.execute("INSERT INTO units VALUES ('u1', '2026-10-03 04:02', 1, 'ab', 5, 0, true, NULL)")
    con.execute("INSERT INTO meta VALUES ('openalex_sources', '2026-10-14')")
    con.execute(
        """CREATE VIEW article_fields AS SELECT * FROM (VALUES ('P1', 'Ecology'), ('P2', 'Ecology'),
           ('P3', 'Ecology'), ('P4', NULL), ('P5', 'Ecology')) t(pmcid, field)"""
    )
    yield path, con
    con.close()


def test_norms_shares_per_field_and_position(db, monkeypatch):
    _, con = db
    monkeypatch.setattr(norms, "MIN_AUTHORS", 1)
    data = norms.build(con, "snap", min_articles=1)
    assert data["files_date"] == "2026-10-03"
    assert data["openalex_sources"] == "2026-10-14"
    assert list(data["fields"]) == ["Ecology"]  # the field-less article is left out
    ecology = data["fields"]["Ecology"]
    assert ecology["articles"] == 2  # the editorial and the article without roles do not count
    assert ecology["authors"] == {"single": 1, "first": 1, "middle": 1, "last": 1}
    share = dict(zip(data["roles"], ecology["shares"]["first"], strict=True))
    assert share["conceptualization"] == 1.0 and share["software"] == 0.0
    assert dict(zip(data["roles"], ecology["shares"]["single"], strict=True))["software"] == 1.0
    assert dict(zip(data["roles"], ecology["shares"]["last"], strict=True))["supervision"] == 1.0


def test_norms_thresholds(db):
    _, con = db
    assert norms.build(con, "snap", min_articles=3)["fields"] == {}
    # Under MIN_AUTHORS a position keeps its count but gets no shares.
    ecology = norms.build(con, "snap", min_articles=1)["fields"]["Ecology"]
    assert ecology["authors"]["first"] == 1 and ecology["shares"]["first"] is None


def test_norms_cli(db, tmp_path, capsys):
    path, con = db
    con.close()
    out = tmp_path / "norms.json"
    assert cli.main(["norms", "--db", str(path), "--min-articles", "1", "--out", str(out)]) == 0
    data = json.loads(out.read_text())
    assert data["snapshot"] == "oa-2026-10" and "Ecology" in data["fields"]
    assert "1 fields" in capsys.readouterr().out
    # No names or per-article ids reach the file.
    assert "P1" not in out.read_text()


def test_norms_needs_fields(tmp_path):
    path = tmp_path / "e.duckdb"
    store.connect(path).close()
    assert cli.main(["norms", "--db", str(path)]) == 1
