import json

import pytest

from census import cli, norms, store


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "n.duckdb"
    con = store.connect(path)
    # P1: three authors in Ecology. P2: a single author in Ecology. P3: an editorial, P4: no field.
    # P5: no roles. P6: three authors in Ecology, the middle one given no role.
    con.execute(
        """INSERT INTO articles (pmcid, article_type, n_authors, n_authors_with_roles, style, statement) VALUES
           ('P1', 'research-article', 3, 3, 'jats4r', NULL), ('P2', 'research-article', 1, 1, 'jats4r', 'x'),
           ('P3', 'editorial', 2, 2, 'jats4r', NULL), ('P4', 'research-article', 2, 2, 'jats4r', NULL),
           ('P5', 'research-article', 2, 0, 'none', NULL), ('P6', 'research-article', 3, 2, 'none', NULL)"""
    )
    con.execute(
        """INSERT INTO assignments VALUES
           ('P1', 1, 'conceptualization'), ('P1', 1, 'writing-original-draft'), ('P1', 2, 'investigation'),
           ('P1', 3, 'supervision'), ('P1', 3, 'conceptualization'), ('P2', 1, 'software'),
           ('P3', 1, 'software'), ('P4', 1, 'software'), ('P6', 1, 'software'), ('P6', 3, 'software')"""
    )
    # The parser read P2's statement the way its publisher tagged it.
    con.execute("INSERT INTO paired VALUES ('P2', 1, 'software')")
    con.execute("INSERT INTO units VALUES ('u1', '2026-10-03 04:02', 1, 'ab', 5, 0, true, NULL)")
    con.execute("INSERT INTO meta VALUES ('openalex_sources', '2026-10-14')")
    con.execute(
        """CREATE VIEW article_fields AS SELECT * FROM (VALUES ('P1', 'Ecology'), ('P2', 'Ecology'),
           ('P3', 'Ecology'), ('P4', NULL), ('P5', 'Ecology'), ('P6', 'Ecology')) t(pmcid, field)"""
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
    assert ecology["articles"] == 3  # the editorial and the article without roles do not count
    # P6's roleless middle author is not in the denominator: the middle share stays 1 of 1, not 1 of 2.
    assert ecology["authors"] == {"single": 1, "first": 2, "middle": 1, "last": 2}
    assert dict(zip(data["roles"], ecology["shares"]["middle"], strict=True))["investigation"] == 1.0
    share = dict(zip(data["roles"], ecology["shares"]["first"], strict=True))
    assert share["conceptualization"] == 0.5 and share["software"] == 0.5
    assert dict(zip(data["roles"], ecology["shares"]["single"], strict=True))["software"] == 1.0
    assert dict(zip(data["roles"], ecology["shares"]["last"], strict=True))["supervision"] == 0.5
    assert data["parser_f1"] == 1.0 and data["parser_f1_articles"] == 1


def test_norms_thresholds(db):
    _, con = db
    assert norms.build(con, "snap", min_articles=4)["fields"] == {}
    # Under MIN_AUTHORS a position keeps its count but gets no shares.
    ecology = norms.build(con, "snap", min_articles=1)["fields"]["Ecology"]
    assert ecology["authors"]["first"] == 2 and ecology["shares"]["first"] is None


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
