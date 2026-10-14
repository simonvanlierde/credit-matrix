import gzip
import urllib.error
from email.message import Message
from http.client import IncompleteRead

import duckdb
import pytest
from helpers import article, contrib

from census import bulk, export, pipeline, pmc_s3, store

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


def test_bucket_unit_reads_versions_and_reports_failures():
    ids = ("PMC1", "PMC2", "PMC3", "PMC4", "PMC5", "PMC6", "PMC7")
    source = pmc_s3.BucketSource(manifest(*ids), VERSIONS, fake_fetch, workers=4, chunk=10)
    (unit,) = source.units()
    rows, record = source.read(unit)
    assert [(r.article["pmcid"], r.article["version"], r.style) for r in rows] == [
        ("PMC1", 1, "contrib_text"),
        ("PMC2", 3, "statement_text"),
        ("PMC3", 1, "error"),
        ("PMC4", None, "missing"),  # not in the inventory
        ("PMC5", 1, "missing"),  # in the inventory, 404 from the bucket
    ]
    assert record == {"unit": unit, "articles": 5, "retries": 2, "finished": False}  # PMC6 and PMC7 retry
    assert rows[2].article["xml_sha256"]  # a broken file still gets its hash
    assert rows[1].roles == [(1, "software"), (2, "software"), (2, "validation")]


def test_run_resumes_unfinished_units_only(tmp_path):
    db = tmp_path / "run.duckdb"
    source = pmc_s3.BucketSource(manifest("PMC1", "PMC2", "PMC6"), VERSIONS, fake_fetch, workers=2, chunk=2)
    assert pipeline.run(source, db, processes=0) == {"contrib_text": 1, "statement_text": 1, "retry": 1}
    # The finished unit is skipped; the one with PMC6 is read again and still waits for it.
    assert pipeline.run(source, db, processes=0) == {"retry": 1}
    with duckdb.connect(str(db)) as con:
        assert con.sql("SELECT count(*) FROM articles").fetchone() == (2,)
        assert con.sql("SELECT unit, finished FROM units ORDER BY 1").fetchall() == [
            ("bucket-00000", True),
            ("bucket-00001", False),
        ]


def test_run_in_worker_processes(tmp_path):
    source = pmc_s3.BucketSource(manifest("PMC1", "PMC2"), VERSIONS, pmc_s3.CachedFetch(tmp_path / "c", fake_fetch))
    assert pipeline.run(source, tmp_path / "p.duckdb", processes=2) == {"contrib_text": 1, "statement_text": 1}


def test_run_stops_when_units_cannot_be_downloaded(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "OUTAGE_UNITS", 2)
    ids = manifest(*(f"PMC{100 + i}" for i in range(20)))

    def down(url: str) -> bytes:
        raise urllib.error.URLError("network unreachable")

    source = pmc_s3.BucketSource(ids, {r["pmcid"]: 1 for r in ids}, down, workers=2, chunk=2)
    counts = pipeline.run(source, tmp_path / "down.duckdb", processes=0)
    assert counts == {"retry": 4, "stopped": 1}


def bulk_file(*articles: bytes) -> bytes:
    return gzip.compress(b"<articles>" + b"".join(articles) + b"</articles>")


def with_pmcid(xml: bytes, pmcid: str) -> bytes:
    return xml.replace(b">PMC1<", f">{pmcid}<".encode())


def test_bulk_source_downloads_hashes_and_parses_a_file(tmp_path):
    files = {"PMC1_PMC9.xml.gz": bulk_file(XML["PMC1"], with_pmcid(XML["PMC2"], "PMC2"), b"<article/>")}
    calls = []

    def download(url: str) -> bytes:
        calls.append(url)
        if url.endswith("PMC10_PMC19.xml.gz"):
            raise urllib.error.URLError("down")
        return files[url.rsplit("/", 1)[1]]

    listing = [{"unit": "PMC1_PMC9.xml.gz", "listed_date": "2026-10-03 04:02"}, {"unit": "PMC10_PMC19.xml.gz"}]
    source = bulk.BulkSource(listing, tmp_path, base="https://x/", download=download)
    rows, record = source.read("PMC1_PMC9.xml.gz")
    assert [(r.article["pmcid"], r.style, r.article["source_unit"]) for r in rows] == [
        ("PMC1", "contrib_text", "PMC1_PMC9.xml.gz"),
        ("PMC2", "statement_text", "PMC1_PMC9.xml.gz"),
    ]  # the article without a PMCID is skipped
    assert record["finished"] and len(record["sha256"]) == 64 and record["articles"] == 2
    source.read("PMC1_PMC9.xml.gz")
    assert len(calls) == 1  # the downloaded file is the cache
    rows, record = source.read("PMC10_PMC19.xml.gz")
    assert (rows, record["finished"], record["retries"]) == ([], False, 1)
    (tmp_path / "PMC1_PMC9.xml.gz").write_bytes(files["PMC1_PMC9.xml.gz"][:40])  # truncated
    assert source.read("PMC1_PMC9.xml.gz")[1]["finished"] is False
    assert not (tmp_path / "PMC1_PMC9.xml.gz").exists()  # removed, so the next read downloads it again


def test_list_files_reads_the_index(monkeypatch):
    page = (
        '<a href="PMC25774_PMC29831.xml.gz">x</a></td><td>2026-10-03 04:02 </td>'
        '<a href="PMC13900_PMC17829.xml.gz">x</a></td><td>2026-10-03 04:01 </td><a href="README.txt">'
    )
    monkeypatch.setattr(bulk, "get", lambda url: page.encode())
    assert bulk.list_files() == [
        {"unit": "PMC13900_PMC17829.xml.gz", "listed_date": "2026-10-03 04:01"},
        {"unit": "PMC25774_PMC29831.xml.gz", "listed_date": "2026-10-03 04:02"},
    ]


def test_cached_fetch_reuses_and_repairs_the_copy(tmp_path):
    calls = []

    def fetch(url: str) -> bytes:
        calls.append(url)
        return b"<article/>"

    read = pmc_s3.CachedFetch(tmp_path, fetch)
    url = pmc_s3.xml_url("PMC1", 2)
    assert read(url) == read(url) == b"<article/>"
    assert calls == [url]
    good = (tmp_path / "PMC1.2.xml.gz").read_bytes()
    for broken in (b"", b"not gzip", good[:10]):
        (tmp_path / "PMC1.2.xml.gz").write_bytes(broken)
        assert read(url) == b"<article/>"
    assert len(calls) == 4  # each broken copy fetched again


TAGGED = article(
    contrib("Ann", "Smith", '<role content-type="http://credit.niso.org/contributor-roles/software/">S</role>')
    + contrib("Bo", "Jones", '<role content-type="http://credit.niso.org/contributor-roles/validation/">V</role>'),
    "<sec><title>Author contributions</title><p>AS: software. BJ: validation, software.</p></sec>",
)


def test_paired_scores_compare_the_statement_with_the_tags(tmp_path):
    with store.connect(tmp_path / "s.duckdb") as con:
        store.insert(con, [store.rows_for("PMC1", "all", TAGGED)])
        assert con.sql("SELECT author_position, role FROM paired ORDER BY ALL").fetchall() == [
            (1, "software"),
            (2, "software"),
            (2, "validation"),
        ]
        assert con.sql("SELECT publisher FROM paired_scores ORDER BY 1").fetchall() == [("(all)",), ("Test Press",)]
        # Tags: 2 pairs. Parsed: 3, of which 2 match.
        assert con.sql(
            "SELECT articles, precision, recall FROM paired_scores WHERE publisher = '(all)'"
        ).fetchone() == (
            1,
            0.667,
            1.0,
        )


def test_export_leaves_names_out_and_keeps_only_open_statements(tmp_path):
    nd = TAGGED.replace(b"licenses/by/4.0", b"licenses/by-nc-nd/4.0").replace(b">PMC1<", b">PMC2<")
    orcid = b'<contrib-id contrib-id-type="orcid">https://orcid.org/0000-0002-1825-0097</contrib-id>'
    with store.connect(tmp_path / "e.duckdb") as con:
        store.insert(
            con,
            [
                store.rows_for("PMC1", "all", TAGGED.replace(b"</name>", b"</name>" + orcid, 1)),
                store.rows_for("PMC2", "all", nd),
            ],
        )
        counts = export.export(con, tmp_path / "out", "test")
        assert counts == {"articles": 2, "assignments": 4, "statements": 1}
        assert con.sql(f"SELECT pmcid FROM '{tmp_path}/out/statements.parquet'").fetchall() == [("PMC1",)]
        assert con.sql(
            f"SELECT orcid FROM '{tmp_path}/out/assignments.parquet' WHERE pmcid = 'PMC1' ORDER BY author_position"
        ).fetchall() == [("0000-0002-1825-0097",), (None,)]
        columns = {c for c, *_ in con.sql(f"DESCRIBE SELECT * FROM '{tmp_path}/out/*.parquet'").fetchall()}
    text = "".join(p.read_text(errors="ignore") for p in (tmp_path / "out").glob("*.parquet"))
    assert "Smith" not in text and "author_name" not in columns


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


def test_rows_without_a_parser_pin_are_refused(tmp_path):
    with store.connect(tmp_path / "old.duckdb") as con:
        con.execute("INSERT INTO articles (pmcid, style) VALUES ('PMC1', 'none')")
        assert store.mismatched_pins(con) == ["rows from code that pinned no parser version"]


def test_assignments_key_rejects_duplicates(tmp_path):
    with store.connect(tmp_path / "k.duckdb") as con, pytest.raises(duckdb.ConstraintException):
        con.execute("INSERT INTO assignments VALUES ('PMC1', 1, 'software'), ('PMC1', 1, 'software')")


def test_export_names_the_bulk_files_it_came_from(tmp_path):
    with store.connect(tmp_path / "f.duckdb") as con:
        unit = {"unit": "PMC1_PMC9.xml.gz", "sha256": "ab" * 32, "articles": 1, "retries": 0, "finished": True}
        store.insert(con, [store.rows_for("PMC1", "all", XML["PMC1"])], unit)
        export.export(con, tmp_path / "out", "test")
    meta = (tmp_path / "out" / "meta.json").read_text()
    assert '"files": "1"' in meta and '"files_digest"' in meta
