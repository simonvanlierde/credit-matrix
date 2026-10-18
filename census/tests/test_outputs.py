import csv
import json

import pytest
from helpers import article, contrib

from census import export, fields, labels, store

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
    unit: store.Unit = {"unit": "u1", "sha256": "ab", "articles": len(XML), "retries": 0, "finished": True}
    store.insert(con, [store.rows_for(pmcid, "all", xml) for pmcid, xml in XML.items()], unit)
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


def test_allocate_by_square_root_of_size():
    assert labels._allocate({"big": 900, "mid": 100, "small": 1}, 10) == {"big": 7, "mid": 3, "small": 0}
    assert sum(labels._allocate({str(i): i + 1 for i in range(30)}, 13).values()) == 13


@pytest.fixture
def set_db(tmp_path):
    """Publisher A has enough paired articles to be measured there; B and C have none."""
    con = store.connect(tmp_path / "s.duckdb")
    articles = [(f"PMC{i}", "A", "statement_text") for i in range(10)]
    articles += [(f"PMC{i}", "B", "statement_text") for i in range(10, 50)]
    articles += [(f"PMC{i}", "C", "contrib_text") for i in range(50, 60)]
    articles += [(f"PMC{i}", "A", "none") for i in range(60, 70)]
    articles += [(f"PMC{i}", labels.DISAGREEMENT_PUBLISHER, "jats4r") for i in range(70, 74)]
    for pmcid, publisher, style in articles:
        con.execute(
            "INSERT INTO articles (pmcid, publisher, style, authors, n_authors, statement)"
            " VALUES (?, ?, ?, ['Ann Smith', 'Bo Jones'], 2, 'AS: software')",
            [pmcid, publisher, style],
        )
    n = labels.PAIRED_ENOUGH
    con.execute("INSERT INTO articles (pmcid, publisher, style) SELECT 'X' || i, 'A', 'jats4r' FROM range(?) t(i)", [n])
    con.execute("INSERT INTO paired SELECT 'X' || i, 1, 'software' FROM range(?) t(i)", [n])
    # PMC70 and PMC71 agree with their tags; PMC72 has an extra parsed role, PMC73 a missing one.
    con.execute("INSERT INTO assignments SELECT 'PMC' || i, 1, 'software' FROM range(70, 74) t(i)")
    con.execute("INSERT INTO paired SELECT 'PMC' || i, 1, 'software' FROM range(70, 73) t(i)")
    con.execute("INSERT INTO paired VALUES ('PMC72', 2, 'resources')")
    yield con
    con.close()


def _rewrite(path, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def test_label_set(set_db, tmp_path):
    out, dis = tmp_path / "set.csv", tmp_path / "dis.csv"
    sizes = {"statement_text": 6, "contrib_text": 3, "none": 4}
    assert labels.export_set(set_db, out, dis, seed=3, sizes=sizes, overlap=5) == (13, 2)
    labels.export_set(set_db, tmp_path / "again.csv", tmp_path / "d2.csv", seed=3, sizes=sizes, overlap=5)
    assert out.read_bytes() == (tmp_path / "again.csv").read_bytes()  # the seed fixes the draw
    with out.open(encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == ["pmcid", "publisher", "style", "overlap", "authors", "text", "gold"]
    # A is measured by its pairs, but its `none` articles never are.
    assert {(r["style"], r["publisher"]) for r in rows} == {
        ("statement_text", "B"),
        ("contrib_text", "C"),
        ("none", "A"),
    }
    assert sum(r["overlap"] == "1" for r in rows) == 5
    assert not any(r["gold"] for r in rows)
    with dis.open(encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert [(r["pmcid"], r["tags"], r["only_tags"], r["only_parser"]) for r in rows] == [
        ("PMC72", "1: software", "", "2: resources"),
        ("PMC73", "1: software", "1: software", ""),
    ]
    rows[0]["wrong"], rows[1]["wrong"] = "parser", "Parser"
    _rewrite(dis, rows)
    assert labels.verdicts(dis) == {"parser": 2}
    rows[1]["wrong"] = "tags"
    _rewrite(dis, rows)
    with pytest.raises(ValueError, match="tags"):
        labels.verdicts(dis)


def test_score_per_publisher_and_agreement(db, tmp_path):
    first, second = tmp_path / "a.csv", tmp_path / "b.csv"
    header = "pmcid,publisher,style,overlap,authors,text,gold\n"
    first.write_text(
        header + "PMC1,P,contrib_text,1,,x,1: software; 2: validation\nPMC2,Q,statement_text,,,x,1: software\n",
        encoding="utf-8-sig",
    )
    second.write_text(
        header + "PMC1,P,contrib_text,1,,x,1: software\nPMC2,Q,statement_text,,,x,\n", encoding="utf-8-sig"
    )
    assert labels.score(db, first, by="publisher") == [
        ("P", 1, 1.0, 1.0, 1.0, 1.0),
        ("Q", 1, 0.333, 1.0, 0.5, 0.0),
    ]
    assert labels.agreement(db, first, second) == (1, 1.0, 0.5, 0.667, 0.0)


def test_export(db, tmp_path, monkeypatch):
    out = tmp_path / "export"
    with pytest.raises(ValueError, match="fields missing"):
        export.export(db, out, "t")
    assert not out.exists()
    # A contrib_text statement as the parser writes it: author positions, no names.
    db.execute(
        "UPDATE articles SET statement = '1: Software; 2: Validation', style = 'contrib_text' WHERE pmcid = 'PMC1'"
    )
    assert export.export(db, out, "t", partial=True) == {"articles": 2, "assignments": 5, "statements": 2}
    names = [n for (a,) in db.sql("SELECT authors FROM articles").fetchall() for n in a]
    for table in ("articles", "assignments"):
        text = " ".join(map(str, db.sql(f"SELECT * FROM read_parquet('{out}/{table}.parquet')").fetchall()))
        assert not any(n in text for n in names)
    (contrib_text,) = db.sql(
        f"SELECT statement FROM '{out}/statements.parquet' WHERE style = 'contrib_text'"
    ).fetchone()
    assert not any(n in contrib_text for n in names)
    types = dict(db.sql(f"SELECT column_name, column_type FROM (DESCRIBE '{out}/articles.parquet')").fetchall())
    assert types["field"] == types["domain"] == types["source_unit"] == "VARCHAR"
    meta = json.loads((out / "meta.json").read_text())
    assert (meta["complete"], meta["units_total"], meta["licenses"]["statements.parquet"]) == (False, 1, "CC-BY-4.0")
    # A failed export leaves the previous one in place and no temporary directory behind.
    monkeypatch.setattr(export, "README", "{missing}")
    with pytest.raises(KeyError):
        export.export(db, out, "t", partial=True)
    assert json.loads((out / "meta.json").read_text()) == meta
    assert [p.name for p in tmp_path.iterdir() if p.name.startswith(".")] == []
