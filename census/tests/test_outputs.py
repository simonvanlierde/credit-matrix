import csv

import pytest
from helpers import article, contrib

from census import fields, labels, store

XML = {
    "PMC1": article(
        contrib("Ann", "Smith", "<role>Software</role>") + contrib("Bo", "Jones", "<role>Validation</role>")
    ),
    "PMC2": article(
        contrib("Ann", "Smith") + contrib("Bo", "Jones"),
        "<sec><title>Author contributions</title><p>=AS: software. BJ: visualization, software.</p></sec>",
    ),
}


@pytest.fixture
def db(tmp_path):
    con = store.connect(tmp_path / "o.duckdb")
    store.insert(con, [store.rows_for(pmcid, "all", xml) for pmcid, xml in XML.items()])
    yield con
    con.close()


def test_fields_per_journal(db, tmp_path):
    topic = "{{'count': {n}, 'field': {{'display_name': '{f}'}}, 'domain': {{'display_name': '{d}'}}}}"
    sources = tmp_path / "sources.parquet"
    db.execute(
        f"""COPY (
            SELECT 'S1' AS id, 'Ecology J' AS display_name, ['1234-5678'] AS issn, ['Test J'] AS alternate_titles,
                   DATE '2026-10-01' AS updated_date,
                   [{topic.format(n=8, f="Ecology", d="Life")}, {topic.format(n=2, f="Physics", d="Physical")}] AS topics
            UNION ALL
            SELECT 'S2', 'Mega J', ['9999-0000'], [], DATE '2026-10-05',
                   [{topic.format(n=1, f="A", d="X")}, {topic.format(n=1, f="B", d="X")}, {topic.format(n=1, f="C", d="X")},
                    {topic.format(n=1, f="D", d="X")}]
        ) TO '{sources}' (FORMAT parquet)"""
    )
    db.execute("UPDATE articles SET issn = ['1234-5678'] WHERE pmcid = 'PMC1'")
    db.execute("UPDATE articles SET issn = ['9999-0000'] WHERE pmcid = 'PMC2'")
    db.execute("INSERT INTO articles (pmcid, journal, issn, style) VALUES ('PMC9', 'test j', [], 'none')")  # by title
    assert fields.build_journals(db, str(sources)) == 2
    assert db.sql("SELECT pmcid, field, domain FROM article_fields ORDER BY 1").fetchall() == [
        ("PMC1", "Ecology", "Life"),
        ("PMC2", "Multidisciplinary", "Multidisciplinary"),
        ("PMC9", "Ecology", "Life"),
    ]
    assert db.sql("SELECT value FROM meta WHERE key = 'openalex_sources'").fetchone() == ("2026-10-05",)


def test_label_export_and_score(db, tmp_path):
    out = tmp_path / "labels.csv"
    assert labels.export(db, out, per_style=5, seed=1) == 2
    with out.open(encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert rows[0]["authors"] == "1. Ann Smith | 2. Bo Jones"
    for row in rows:  # blind: no prediction anywhere but the source text
        assert not row["gold"]
    assert next(r["text"] for r in rows if r["pmcid"] == "PMC2").startswith("'=")  # no spreadsheet formula
    gold = {"PMC1": "1: software; 2: validation", "PMC2": "1: software; 2: visualization"}
    for row in rows:
        row["gold"] = gold[row["pmcid"]]
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    # PMC2's parser output adds software for author 2: one false positive.
    assert labels.score(db, out) == [
        ("contrib_text", 1, 1.0, 1.0, 1.0, 1.0),
        ("statement_text", 1, 0.667, 1.0, 0.8, 0.0),
    ]


def test_parse_gold():
    assert labels.parse_gold("1: Software; all: writing – review & editing", 2) == {
        (1, "software"),
        (1, "writing-review-editing"),
        (2, "writing-review-editing"),
    }
    assert labels.parse_gold("none", 3) == set()
    for bad in ("A.S.: software", "²: software", "software", "3: software", "1: drew the figures"):
        with pytest.raises(ValueError, match="'"):
            labels.parse_gold(bad, 2)


def test_score_unknown_pmcid(db, tmp_path):
    out = tmp_path / "labels.csv"
    out.write_text("pmcid,style,authors,text,gold\nPMC404,none,,x,none\n", encoding="utf-8-sig")
    with pytest.raises(ValueError, match="PMC404"):
        labels.score(db, out)
