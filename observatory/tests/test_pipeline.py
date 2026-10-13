import csv
import urllib.error
from email.message import Message

import duckdb
import pytest
from test_jats import article, contrib

from observatory import fields, labels, pmc_s3, store
from observatory.cli import run
from observatory.snapshot import read_manifest, write_manifest

XML = {
    "PMC1": article(
        contrib("Ann", "Smith", "<role>Software</role>") + contrib("Bo", "Jones", "<role>Validation</role>")
    ),
    "PMC2": article(
        contrib("Ann", "Smith") + contrib("Bo", "Jones"),
        "<sec><title>Author contributions</title><p>AS: software. BJ: validation, software.</p></sec>",
    ),
    "PMC3": b"<article><broken",
}
VERSIONS = {"PMC1": 1, "PMC2": 3, "PMC3": 1, "PMC5": 1, "PMC6": 1}


def fake_fetch(url: str) -> bytes:
    pmcid = url.rsplit("/", 1)[1].split(".")[0]
    if pmcid == "PMC6":
        raise urllib.error.URLError("connection reset")
    if pmcid not in XML:
        raise urllib.error.HTTPError(url, 404, "Not Found", Message(), None)
    return XML[pmcid]


def manifest(*ids: str) -> list[dict[str, str]]:
    return [{"pmcid": i, "stratum": "all", "year": ""} for i in ids]


def test_stream_reads_versions_and_reports_failures():
    ids = ("PMC1", "PMC2", "PMC3", "PMC4", "PMC5", "PMC6")
    results = list(pmc_s3.stream(manifest(*ids), VERSIONS, 4, fake_fetch, processes=2))
    styles = [(article[0], article[2], article[11]) for article, _ in results]
    assert styles == [
        ("PMC1", 1, "contrib_text"),
        ("PMC2", 3, "statement_text"),
        ("PMC3", 1, "error"),
        ("PMC4", None, "missing"),  # not in the inventory
        ("PMC5", 1, "missing"),  # in the inventory, 404 from the bucket
        ("PMC6", 1, "retry"),  # network error
    ]
    assert results[2][0][3]  # a broken file still gets its hash


def test_run_resumes(tmp_path):
    db = tmp_path / "run.duckdb"
    assert run(manifest("PMC1"), VERSIONS, db, 2, fake_fetch) == {"contrib_text": 1}
    assert run(manifest("PMC1", "PMC2", "PMC6"), VERSIONS, db, 2, fake_fetch) == {"statement_text": 1, "retry": 1}
    assert run(manifest("PMC1", "PMC2", "PMC6"), VERSIONS, db, 2, fake_fetch) == {"retry": 1}  # retried, not stored
    with duckdb.connect(str(db)) as con:
        assert con.sql("SELECT count(*) FROM articles").fetchone() == (2,)
        assert con.sql("SELECT authors FROM articles WHERE pmcid = 'PMC2'").fetchone() == (["Ann Smith", "Bo Jones"],)


def test_gzipped_manifest_round_trip(tmp_path):
    path = tmp_path / "m.csv.gz"
    write_manifest(manifest("PMC1", "PMC2"), path)
    assert read_manifest(path) == manifest("PMC1", "PMC2")


@pytest.fixture
def db(tmp_path):
    con = store.connect(tmp_path / "o.duckdb")
    store.insert(con, [store.rows_for(pmcid, "all", XML[pmcid]) for pmcid in ("PMC1", "PMC2")])
    yield con
    con.close()


def test_fields_per_journal(db, tmp_path):
    topic = "{{'count': {n}, 'field': {{'display_name': '{f}'}}, 'domain': {{'display_name': '{d}'}}}}"
    sources = tmp_path / "sources.parquet"
    db.execute(
        f"""COPY (
            SELECT 'S1' AS id, 'Ecology J' AS display_name, ['1234-5678'] AS issn, ['Test J'] AS alternate_titles,
                   [{topic.format(n=8, f="Ecology", d="Life")}, {topic.format(n=2, f="Physics", d="Physical")}] AS topics
            UNION ALL
            SELECT 'S2', 'Mega J', ['9999-0000'], [],
                   [{topic.format(n=1, f="A", d="X")}, {topic.format(n=1, f="B", d="X")}, {topic.format(n=1, f="C", d="X")},
                    {topic.format(n=1, f="D", d="X")}]
        ) TO '{sources}' (FORMAT parquet)"""
    )
    db.execute("UPDATE articles SET issn = ['1234-5678'] WHERE pmcid = 'PMC1'")
    db.execute("UPDATE articles SET issn = ['9999-0000'] WHERE pmcid = 'PMC2'")
    db.execute("INSERT INTO articles (pmcid, journal, issn) VALUES ('PMC9', 'test j', [])")  # matched by title
    assert fields.build_journals(db, str(sources)) == 2
    assert db.sql("SELECT pmcid, field, domain FROM article_fields ORDER BY 1").fetchall() == [
        ("PMC1", "Ecology", "Life"),
        ("PMC2", "Multidisciplinary", "Multidisciplinary"),
        ("PMC9", "Ecology", "Life"),
    ]


def test_label_export_and_score(db, tmp_path):
    out = tmp_path / "labels.csv"
    assert labels.export(db, out, per_style=5, seed=1) == 2
    with out.open() as f:
        rows = list(csv.DictReader(f))
    assert rows[0]["authors"] == "1. Ann Smith | 2. Bo Jones"
    assert "software" not in rows[0]["gold"]  # blind: no prediction in the file
    gold = {"PMC1": "1: software; 2: validation", "PMC2": "1: software; 2: validation"}
    for row in rows:
        row["gold"] = gold[row["pmcid"]]
    with out.open("w", newline="") as f:
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
    with pytest.raises(ValueError, match="neither"):
        labels.parse_gold("A.S.: software", 2)


def test_cached_fetch_reuses_the_copy(tmp_path):
    calls = []

    def fetch(url: str) -> bytes:
        calls.append(url)
        return b"<article/>"

    read = pmc_s3.cached(fetch, tmp_path)
    url = pmc_s3.xml_url("PMC1", 2)
    assert read(url) == read(url) == b"<article/>"
    assert calls == [url]
    assert (tmp_path / "PMC1.2.xml.gz").exists()


def test_pin_keeps_the_first_value(tmp_path):
    with store.connect(tmp_path / "p.duckdb") as con:
        assert store.pin(con, "inventory", "2026-10-12") == "2026-10-12"
        assert store.pin(con, "inventory", "2026-10-13") == "2026-10-12"
