import urllib.error
from email.message import Message
from http.client import IncompleteRead

import duckdb
import pytest
from helpers import article, contrib

from census import pipeline, pmc_s3, store

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
VERSIONS = {"PMC1": 1, "PMC2": 3, "PMC3": 1, "PMC5": 1, "PMC6": 1, "PMC7": 1}


def fake_fetch(url: str) -> bytes:
    pmcid = url.rsplit("/", 1)[1].split(".")[0]
    if pmcid == "PMC6":
        raise urllib.error.URLError("connection reset")
    if pmcid == "PMC7":
        raise IncompleteRead(b"half")  # not an OSError
    if pmcid not in XML:
        raise urllib.error.HTTPError(url, 404, "Not Found", Message(), None)
    return XML[pmcid]


def manifest(*ids: str) -> list[dict[str, str]]:
    return [{"pmcid": i, "stratum": "all", "year": ""} for i in ids]


def test_stream_reads_versions_and_reports_failures():
    ids = ("PMC1", "PMC2", "PMC3", "PMC4", "PMC5", "PMC6", "PMC7")
    results = list(pmc_s3.stream(manifest(*ids), VERSIONS, 4, fake_fetch, processes=2))
    assert [(r.article["pmcid"], r.article["version"], r.style) for r in results] == [
        ("PMC1", 1, "contrib_text"),
        ("PMC2", 3, "statement_text"),
        ("PMC3", 1, "error"),
        ("PMC4", None, "missing"),  # not in the inventory
        ("PMC5", 1, "missing"),  # in the inventory, 404 from the bucket
        ("PMC6", 1, "retry"),  # network error
        ("PMC7", 1, "retry"),  # body cut short
    ]
    assert results[2].article["xml_sha256"]  # a broken file still gets its hash
    assert results[1].roles == [(1, "software"), (2, "software"), (2, "validation")]


def test_run_resumes_and_retries(tmp_path):
    db = tmp_path / "run.duckdb"
    assert pipeline.run(manifest("PMC1"), VERSIONS, db, 2, fake_fetch, 1) == {"contrib_text": 1}
    ids = manifest("PMC1", "PMC2", "PMC6")
    assert pipeline.run(ids, VERSIONS, db, 2, fake_fetch, 1) == {"statement_text": 1, "retry": 1}
    assert pipeline.run(ids, VERSIONS, db, 2, fake_fetch, 1) == {"retry": 1}  # retried, not stored
    with duckdb.connect(str(db)) as con:
        assert con.sql("SELECT count(*) FROM articles").fetchone() == (2,)
        assert con.sql("SELECT authors FROM articles WHERE pmcid = 'PMC2'").fetchone() == (["Ann Smith", "Bo Jones"],)


def test_run_stops_when_every_download_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "OUTAGE_WINDOW", 10)
    ids = manifest(*(f"PMC{100 + i}" for i in range(50)))
    versions = {r["pmcid"]: 1 for r in ids}

    def down(url: str) -> bytes:
        raise urllib.error.URLError("network unreachable")

    counts = pipeline.run(ids, versions, tmp_path / "down.duckdb", 2, down, 1)
    assert counts["stopped"] == 1
    assert counts["retry"] < 50


def test_cached_fetch_reuses_and_repairs_the_copy(tmp_path):
    calls = []

    def fetch(url: str) -> bytes:
        calls.append(url)
        return b"<article/>"

    read = pmc_s3.cached(fetch, tmp_path)
    url = pmc_s3.xml_url("PMC1", 2)
    assert read(url) == read(url) == b"<article/>"
    assert calls == [url]
    good = (tmp_path / "PMC1.2.xml.gz").read_bytes()
    for broken in (b"", b"not gzip", good[:10]):
        (tmp_path / "PMC1.2.xml.gz").write_bytes(broken)
        assert read(url) == b"<article/>"
    assert len(calls) == 4  # each broken copy fetched again


def test_insert_stores_a_rejected_row_as_an_error(tmp_path):
    with store.connect(tmp_path / "i.duckdb") as con:
        good = store.rows_for("PMC1", "all", XML["PMC1"])
        bad = store.rows_for("PMC2", "all", XML["PMC2"])
        bad.article["year"] = "not a year"
        store.insert(con, [good, bad])
        assert con.sql("SELECT pmcid, style FROM articles ORDER BY 1").fetchall() == [
            ("PMC1", "contrib_text"),
            ("PMC2", "error"),
        ]


def test_pins_refuse_rows_from_other_code(tmp_path, monkeypatch):
    with store.connect(tmp_path / "p.duckdb") as con:
        assert store.mismatched_pins(con) == []
        assert store.pin(con, "inventory", "2026-10-12") == "2026-10-12"
        assert store.pin(con, "inventory", "2026-10-13") == "2026-10-12"
        old = store.PARSER_VERSION
        monkeypatch.setattr(store, "PARSER_VERSION", "changed")
        assert store.mismatched_pins(con) == [f"parser {old} (this code: changed)"]


def test_assignments_key_rejects_duplicates(tmp_path):
    with store.connect(tmp_path / "k.duckdb") as con, pytest.raises(duckdb.ConstraintException):
        con.execute("INSERT INTO assignments VALUES ('PMC1', 1, 'software'), ('PMC1', 1, 'software')")


def test_rows_without_a_parser_pin_are_refused(tmp_path):
    with store.connect(tmp_path / "old.duckdb") as con:
        con.execute("INSERT INTO articles (pmcid, style) VALUES ('PMC1', 'none')")
        assert store.mismatched_pins(con) == ["rows from code that pinned no parser version"]
