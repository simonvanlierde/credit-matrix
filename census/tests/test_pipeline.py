import ast
import gzip
import hashlib
import os
import urllib.error
from email.message import Message
from http.client import IncompleteRead
from pathlib import Path

import duckdb
import pytest
from helpers import article, contrib

from census import bulk, export, pipeline, pmc_s3, rows, store

XML = {
    "PMC1": article(
        contrib("Ann", "Smith", "<role>Software</role>") + contrib("Bo", "Jones", "<role>Validation</role>")
    ),
    "PMC2": article(
        contrib("Ann", "Smith") + contrib("Bo", "Jones"),
        "<sec><title>Author contributions</title><p>AS: software. BJ: visualization, software.</p></sec>",
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
    assert record == {  # PMC6 and PMC7 retry
        "unit": unit,
        "articles": 5,
        "retries": 2,
        "finished": False,
        "error": "2 downloads failed, e.g. fetch failed: URLError: <urlopen error connection reset>",
    }
    assert rows[2].article["xml_sha256"]  # a broken file still gets its hash
    assert rows[1].roles == [(1, "software"), (2, "software"), (2, "visualization")]


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

    def download(url: str, path) -> None:
        calls.append(url)
        if url.endswith("PMC10_PMC19.xml.gz"):
            raise urllib.error.URLError("down")
        path.write_bytes(files[url.rsplit("/", 1)[1]])

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
    malformed = tmp_path / "PMC20_PMC29.xml.gz"
    malformed.write_bytes(bulk_file(XML["PMC1"], b"<article><oops></article>"))
    source = bulk.BulkSource([{"unit": malformed.name}], tmp_path, download=download)
    rows, record = source.read(malformed.name)
    assert (rows, record["finished"], record["retries"]) == ([], False, 0)
    assert record["error"].startswith("ParseError") and malformed.exists()  # a good download is kept


def test_bulk_source_refuses_a_file_that_differs_from_its_pin(tmp_path):
    (tmp_path / "PMC1_PMC9.xml.gz").write_bytes(bulk_file(XML["PMC1"]))
    source = bulk.BulkSource([{"unit": "PMC1_PMC9.xml.gz", "sha256": "ab" * 32}], tmp_path)
    rows, record = source.read("PMC1_PMC9.xml.gz")
    assert (rows, record["finished"]) == ([], False)
    assert f"is not the pinned {'ab' * 32}" in record["error"]


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
        counts = export.export(con, tmp_path / "out", "test", partial=True)
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


def unit(name: str) -> store.Unit:
    return {"unit": name, "articles": 0, "retries": 0, "finished": True}


def test_an_article_in_two_units_is_replaced_not_duplicated(tmp_path):
    with store.connect(tmp_path / "d.duckdb") as con:
        store.insert(con, [store.rows_for("PMC1", "all", XML["PMC1"])], unit("a"))
        again = store.rows_for("PMC1", "all", XML["PMC1"])
        store.insert(con, [again, store.rows_for("PMC2", "all", XML["PMC2"])], unit("b"))
        assert con.sql("SELECT pmcid FROM articles ORDER BY 1").fetchall() == [("PMC1",), ("PMC2",)]
        assert con.sql("SELECT count(*) FROM assignments WHERE pmcid = 'PMC1'").fetchone() == (len(again.roles),)
        assert con.sql("SELECT unit FROM units ORDER BY 1").fetchall() == [("a",), ("b",)]


def test_pins_refuse_rows_from_other_code(tmp_path, monkeypatch, capsys):
    db = tmp_path / "p.duckdb"
    with store.connect(db) as con:
        assert store.mismatched_pins(con) == []
        assert store.pin(con, "inventory", "2026-10-12") == "2026-10-12"
        assert store.pin(con, "inventory", "2026-10-13") == "2026-10-12"
    old = store.PARSER_VERSION
    monkeypatch.setattr(store, "PARSER_VERSION", "changed")
    with pytest.raises(store.PinMismatch, match=f"parser {old} \\(this code: changed\\)"):
        store.connect(db)
    store.connect(db, read_only=True).close()  # a reader only warns
    assert f"warning: {db} was built by other code (parser {old}" in capsys.readouterr().err


def test_parser_version_covers_exactly_the_code_that_makes_rows():
    """rows.py and every census module it imports, directly or not, and nothing else."""
    src = Path(store.__file__).parent
    todo, seen = ["rows"], set()
    while todo:
        name = todo.pop()
        seen.add(name)
        for node in ast.walk(ast.parse((src / f"{name}.py").read_text(encoding="utf-8"))):
            module = node.module if isinstance(node, ast.ImportFrom) else None
            if module and module.startswith("census.") and module[7:] not in seen:
                todo.append(module[7:])
    assert {f"{name}.py" for name in seen} == set(store._PARSER_FILES)
    digest = hashlib.sha256(b"".join((src / name).read_bytes() for name in store._PARSER_FILES))
    assert digest.hexdigest()[:12] == store.PARSER_VERSION


def test_schema_version_follows_the_tables():
    source = Path(store.__file__).read_text(encoding="utf-8")
    edited = source.replace('"doi": "VARCHAR"', '"doi": "INTEGER"')
    assert edited != source
    namespace = {"__file__": store.__file__, "__name__": "edited"}
    exec(compile(edited, store.__file__, "exec"), namespace)
    assert namespace["SCHEMA_VERSION"] != store.SCHEMA_VERSION


def test_rows_without_a_parser_pin_are_refused(tmp_path):
    with duckdb.connect(str(tmp_path / "old.duckdb")) as con:
        con.execute(store.SCHEMA)
        con.execute("INSERT INTO articles (pmcid, style) VALUES ('PMC1', 'none')")
        assert store.mismatched_pins(con) == ["rows from code that pinned no parser version"]


def test_assignments_key_rejects_duplicates(tmp_path):
    with store.connect(tmp_path / "k.duckdb") as con, pytest.raises(duckdb.ConstraintException):
        con.execute("INSERT INTO assignments VALUES ('PMC1', 1, 'software'), ('PMC1', 1, 'software')")


def test_export_names_the_bulk_files_it_came_from(tmp_path):
    with store.connect(tmp_path / "f.duckdb") as con:
        unit: store.Unit = {
            "unit": "PMC1_PMC9.xml.gz",
            "sha256": "ab" * 32,
            "articles": 1,
            "retries": 0,
            "finished": True,
        }
        store.insert(con, [store.rows_for("PMC1", "all", XML["PMC1"])], unit)
        export.export(con, tmp_path / "out", "test", partial=True)
    meta = (tmp_path / "out" / "meta.json").read_text()
    assert '"files": "1"' in meta and '"files_digest"' in meta


def pmc(pmcid: str) -> rows.Rows:
    return rows.rows_for(pmcid, "all", with_pmcid(XML["PMC1"], pmcid))


def test_insert_replaces_an_article_another_unit_holds_last_in_the_batch(tmp_path):
    with store.connect(tmp_path / "dup.duckdb") as con:
        store.insert(con, [pmc("PMC1"), pmc("PMC2")], unit("a"))
        store.insert(con, [pmc("PMC3"), pmc("PMC2")], unit("b"))
        store.insert(con, [pmc("PMC9"), pmc("PMC9")], unit("c"))
        assert con.sql("SELECT pmcid FROM articles ORDER BY 1").fetchall() == [
            ("PMC1",),
            ("PMC2",),
            ("PMC3",),
            ("PMC9",),
        ]
        assert con.sql("SELECT unit FROM units ORDER BY 1").fetchall() == [("a",), ("b",), ("c",)]


def test_reading_a_recorded_unit_again_replaces_all_its_rows(tmp_path):
    with store.connect(tmp_path / "again.duckdb") as con:
        store.insert(con, [rows.rows_for("PMC1", "all", TAGGED)], unit("a"))
        assert con.sql("SELECT count(*) FROM paired").fetchone() == (3,)
        changed = rows.rows_for("PMC1", "all", XML["PMC1"])
        store.insert(con, [changed], unit("a"))
        assert con.sql("SELECT count(*) FROM paired").fetchone() == (0,)  # no stale statement reading
        assert con.sql("SELECT author_position, role FROM assignments ORDER BY 1").fetchall() == changed.roles
        assert con.sql("SELECT style FROM articles").fetchall() == [("contrib_text",)]


def test_insert_lets_storage_errors_through_and_records_no_unit(tmp_path, monkeypatch):
    def full_disk(*args):
        raise duckdb.IOException("No space left on device")

    with store.connect(tmp_path / "io.duckdb") as con:
        monkeypatch.setattr(store, "_insert", full_disk)
        with pytest.raises(duckdb.IOException):
            store.insert(con, [pmc("PMC1")], unit("a"))
        assert con.sql("SELECT count(*) FROM units").fetchone() == (0,)


class DyingSource:
    name = "dying"

    def units(self) -> list[str]:
        return ["u"]

    def read(self, unit: str):
        os._exit(1)


def test_run_stops_when_a_worker_dies(tmp_path, capsys):
    assert pipeline.run(DyingSource(), tmp_path / "w.duckdb", processes=1) == {"stopped": 1}
    assert "a worker process died" in capsys.readouterr().err
