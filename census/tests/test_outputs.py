import csv
import json
from collections import Counter
from itertools import pairwise

import pytest
from helpers import article, contrib

from census import cli, export, fields, labels, store

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
    assert list(rows[0]) == ["pmcid", "authors", "text", "gold"]  # blind: no style, the parser's verdict
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
    assert [r[:6] for r in labels.score(db, out)] == [
        ("contrib_text", 1, 1.0, 1.0, 1.0, 1.0),
        ("statement_text", 1, 0.667, 1.0, 0.8, 0.0),
    ]
    # With no key file, the publisher is the database's.
    assert [r[0] for r in labels.score(db, out, by="publisher")] == [
        "contrib_text: Test Press",
        "statement_text: Test Press",
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
    # A stratum smaller than its share hands the rest to the others, until the pool runs out.
    assert labels._allocate({"a": 100, "b": 1}, 30) == {"a": 29, "b": 1}
    assert labels._allocate({"a": 3, "b": 1}, 10) == {"a": 3, "b": 1}


@pytest.fixture
def set_db(tmp_path):
    """Publisher A has enough tagged articles to be measured by paired_scores; B to E have none. D is
    under MIN_SHARE of statement_text, so it is sampled within "(other)"."""
    con = store.connect(tmp_path / "s.duckdb")
    articles = [("PMC", 0, 10, "A", "statement_text"), ("B", 0, 200, "B", "statement_text")]
    articles += [("D", 0, 1, "D", "statement_text"), ("C", 0, 10, "C", "contrib_text")]
    articles += [("E", 0, 1, "E", "contrib_text"), ("PMC", 60, 70, "A", "none")]
    articles += [("PMC", 70, 74, labels.DISAGREEMENT_PUBLISHER, "jats4r")]
    for prefix, start, stop, publisher, style in articles:
        con.execute(
            "INSERT INTO articles (pmcid, publisher, style, authors, n_authors, statement)"
            " SELECT ? || i, ?, ?, ['Ann Smith', 'Bo Jones'], 2, 'AS: software' FROM range(?, ?) t(i)",
            [prefix, publisher, style, start, stop],
        )
    # Tags but no parsed role: paired_scores still counts these articles, so A is measured.
    n = labels.PAIRED_ENOUGH
    con.execute(
        "INSERT INTO articles (pmcid, publisher, style, statement) SELECT 'X' || i, 'A', 'jats4r', 'x' FROM range(?) t(i)",
        [n],
    )
    con.execute("INSERT INTO assignments SELECT 'X' || i, 1, 'software' FROM range(?) t(i)", [n])
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
    sizes = {"statement_text": 15, "contrib_text": 8, "none": 4}
    assert labels.export_set(set_db, out, seed=3, sizes=sizes, overlap=5) == 27
    labels.export_set(set_db, tmp_path / "again.csv", seed=3, sizes=sizes, overlap=5)
    assert out.read_bytes() == (tmp_path / "again.csv").read_bytes()  # the seed fixes the draw
    with out.open(encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    # Blind: no style (the parser's verdict), stratum or weight in the labeller's file.
    assert list(rows[0]) == ["pmcid", "overlap", "authors", "text", "gold"]
    style = dict(set_db.sql("SELECT pmcid, style FROM articles").fetchall())
    styles = [style[r["pmcid"]] for r in rows]
    assert sum(a != b for a, b in pairwise(styles)) > len(sizes)  # shuffled, not in blocks
    with labels.key_path(out).open(encoding="utf-8-sig") as f:
        key = list(csv.DictReader(f))
    assert sorted(r["pmcid"] for r in key) == sorted(r["pmcid"] for r in rows)
    # A is measured by paired_scores, but its `none` articles never are. E has 1 article for its 2-row
    # share, so C takes the other. Weight is the stratum's articles over its rows.
    weights = {(style[r["pmcid"]], r["publisher"]): r["weight"] for r in key}
    assert weights == {
        ("statement_text", "B"): "14.2857",
        ("statement_text", "(other)"): "1",
        ("contrib_text", "C"): "1.42857",
        ("contrib_text", "E"): "1",
        ("none", "A"): "2.5",
    }
    assert Counter(styles) == sizes
    assert sum(r["overlap"] == "1" for r in rows) == 5
    assert not any(r["gold"] for r in rows)
    assert labels.export_disagreements(set_db, dis, seed=3) == 2
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


def test_label_set_cli(set_db, tmp_path, capsys):
    set_db.close()
    out = tmp_path / "cli.csv"
    assert cli.main(["label", "--set", "--db", str(tmp_path / "s.duckdb"), "--out", str(out)]) == 0
    # The default sizes ask for more contrib_text (11) and none (10) rows than there are: all are taken.
    assert "121 articles to label" in capsys.readouterr().out
    assert len((tmp_path / "cli-disagreements.csv").read_text(encoding="utf-8-sig").splitlines()) == 3
    assert len((tmp_path / "cli-key.csv").read_text(encoding="utf-8-sig").splitlines()) == 122


def test_label_export_is_blind_and_shuffled(set_db, tmp_path):
    out = tmp_path / "sample.csv"
    assert labels.export(set_db, out, per_style=5, seed=3) == 15
    with out.open(encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    style = dict(set_db.sql("SELECT pmcid, style FROM articles").fetchall())
    assert sum(a != b for a, b in pairwise(style[r["pmcid"]] for r in rows)) > len(labels.TEXT_STYLES)


def _labels(path, rows, key=None):
    """A labeller's file, and its key file when `key` is given."""
    path.write_text("pmcid,overlap,authors,text,gold\n" + rows, encoding="utf-8-sig")
    if key is not None:
        labels.key_path(path).write_text("pmcid,publisher,weight\n" + key, encoding="utf-8-sig")


def test_score_weights_rows_by_stratum(db, tmp_path):
    db.execute("UPDATE articles SET style = 'contrib_text'")
    out = tmp_path / "w.csv"
    # PMC2's parser output has 2 right pairs and 1 wrong; its row stands for 3 articles.
    _labels(
        out, "PMC1,,,x,1: software; 2: validation\nPMC2,,,x,1: software; 2: visualization\n", "PMC1,P,1\nPMC2,Q,3\n"
    )
    [(style, n, precision, recall, f1, exact, low, high)] = labels.score(db, out)
    assert (style, n, precision, recall, f1, exact) == ("contrib_text", 2, 0.727, 1.0, 0.842, 0.25)
    assert low < exact < high
    # A copy under another name finds no key beside it, so it is given one.
    copy = tmp_path / "copy.csv"
    copy.write_bytes(out.read_bytes())
    assert labels.score(db, copy, key=labels.key_path(out))[0][:6] == (style, n, precision, recall, f1, exact)
    _labels(out, "PMC1,,,x,1: software\n", "PMC2,Q,3\n")
    with pytest.raises(ValueError, match="PMC1: not in"):
        labels.score(db, out)


def test_score_with_predictions_equal_to_the_parser(db, tmp_path, capsys):
    out = tmp_path / "w.csv"
    _labels(
        out, "PMC1,,,x,1: software; 2: validation\nPMC2,,,x,1: software; 2: visualization\n", "PMC1,P,1\nPMC2,Q,3\n"
    )
    preds = tmp_path / "preds.jsonl"
    with preds.open("w") as f:
        for pmcid in ("PMC1", "PMC2"):
            pairs = db.execute("SELECT author_position, role FROM assignments WHERE pmcid = ?", [pmcid]).fetchall()
            f.write(json.dumps({"pmcid": pmcid, "pairs": pairs}) + "\n")
    db.close()
    base = ["score", str(out), "--db", str(tmp_path / "o.duckdb")]
    assert cli.main(base) == 0
    parser = capsys.readouterr().out
    assert cli.main([*base, "--predictions", str(preds)]) == 0
    assert capsys.readouterr().out == parser
    assert "statement_text: Q" in parser  # the key file's strata are used


def test_score_per_style_and_publisher(db, tmp_path):
    db.execute("INSERT INTO articles (pmcid, publisher, style, n_authors) VALUES ('PMC8', 'P', 'none', 1)")
    db.execute("INSERT INTO articles (pmcid, publisher, style, n_authors) VALUES ('PMC9', 'P', 'none', 1)")
    out = tmp_path / "p.csv"
    # P is a stratum in two styles; nothing was predicted for PMC8 and PMC9, so precision is None.
    _labels(
        out,
        "PMC1,,,x,1: software; 2: validation\nPMC8,,,x,1: software\nPMC9,,,x,none\n",
        "PMC1,P,1\nPMC8,P,1\nPMC9,P,1\n",
    )
    assert [r[:6] for r in labels.score(db, out, by="publisher")] == [
        ("contrib_text: P", 1, 1.0, 1.0, 1.0, 1.0),
        ("none: P", 2, None, 0.0, 0.0, 0.5),
    ]
    _labels(out, "PMC9,,,x,none\n", "PMC9,P,1\n")
    assert labels.score(db, out)[0][:6] == ("none", 1, None, None, None, 1.0)


def test_score_per_role(db, tmp_path):
    out = tmp_path / "r.csv"
    # PMC2's parser output adds software for author 2; author 2's visualization is right.
    _labels(out, "PMC1,,,x,1: software; 2: validation\nPMC2,,,x,1: software; 2: visualization\n")
    assert [r[:6] for r in labels.score(db, out, by="role")] == [
        ("contrib_text: software", 1, 1.0, 1.0, 1.0, 1.0),
        ("contrib_text: validation", 1, 1.0, 1.0, 1.0, 1.0),
        ("statement_text: software", 1, 0.5, 1.0, 0.667, 0.0),
        ("statement_text: visualization", 1, 1.0, 1.0, 1.0, 1.0),
    ]


def test_agreement_on_overlap_rows_only(db, tmp_path):
    first, second = tmp_path / "a.csv", tmp_path / "b.csv"
    # PMC2 is labelled the same in both but is not an overlap row, so it does not count.
    _labels(first, "PMC1,1,,x,1: software; 2: validation\nPMC2,,,x,1: software\n")
    _labels(second, "PMC1,1,,x,1: software\nPMC2,,,x,1: software\n")
    assert labels.agreement(db, first, second)[:5] == (1, 1.0, 0.5, 0.667, 0.0)


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
