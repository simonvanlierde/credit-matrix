import hashlib

import pytest
from helpers import article, contrib

from census import cli, release, store

pytest.importorskip("sourceledger")

OPEN = "https://creativecommons.org/licenses/by/4.0/"
RESTRICTED = "https://creativecommons.org/licenses/by-nc/4.0/"
SECRET = "A sentence under a non-commercial licence"
XML = {
    "PMC1": article(contrib("Ann", "Smith", "<role>Software</role>")),
    "PMC2": article(contrib("Bo", "Jones", "<role>Validation</role>")),
}


@pytest.fixture
def setup(tmp_path):
    cache = tmp_path / "bulk"
    cache.mkdir()
    body = b"<bulk file one>"
    (cache / "PMC1_PMC2.xml.gz").write_bytes(body)
    con = store.connect(tmp_path / "o.duckdb")
    unit: store.Unit = {
        "unit": "PMC1_PMC2.xml.gz",
        "size": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "articles": 2,
        "retries": 0,
        "finished": True,
    }
    store.insert(con, [store.rows_for(pmcid, "all", xml) for pmcid, xml in XML.items()], unit)
    con.execute("UPDATE articles SET statement = 'An open statement', license = ? WHERE pmcid = 'PMC1'", [OPEN])
    con.execute("UPDATE articles SET statement = ?, license = ? WHERE pmcid = 'PMC2'", [SECRET, RESTRICTED])
    yield con, cache, tmp_path
    con.close()


def _leaks(out):
    return [p.name for p in out.rglob("*") if p.is_file() and SECRET.encode() in p.read_bytes()]


def test_release_holds_no_restricted_text_and_verify_sees_a_changed_input(setup):
    con, cache, tmp = setup
    out = tmp / "release"
    counts = release.release(con, out, "t", cache, tmp / "ledger", partial=True)
    assert counts["statements"] == 1
    files = sorted(p.name for p in (out / "data").iterdir())
    assert files == [
        "articles.parquet",
        "assignments.parquet",
        "attribution.md",
        "inputs.csv",
        "meta.json",
        "readme.md",
        "statements.parquet",
    ]
    # The open statement is in the release, the restricted one in no file and no table.
    shipped = con.sql(f"SELECT statement FROM '{out}/data/statements.parquet'").fetchall()
    assert shipped == [("An open statement",)]
    assert _leaks(out) == []
    (out / "planted.txt").write_text(SECRET)  # positive control: the search sees a leak
    assert _leaks(out) == ["planted.txt"]
    (out / "planted.txt").unlink()
    assert not any(p.name.startswith("bulk-") for p in out.rglob("*"))  # the bulk files are not shipped
    # inputs.csv names the bulk file and its hash; the sources are listed as excluded in the package.
    inputs = (out / "data" / "inputs.csv").read_text()
    assert "PMC1_PMC2.xml.gz" in inputs and hashlib.sha256(b"<bulk file one>").hexdigest() in inputs
    assert "bulk-PMC1_PMC2" not in (out / "datapackage.json").read_text()
    assert release.verify(out, cache) == []
    # One byte of one input changes, and verify says which.
    (cache / "PMC1_PMC2.xml.gz").write_bytes(b"<bulk file ONE>")
    [problem] = release.verify(out, cache)
    assert "PMC1_PMC2.xml.gz: input changed" in problem
    # A changed output fails too.
    (cache / "PMC1_PMC2.xml.gz").write_bytes(b"<bulk file one>")
    (out / "data" / "articles.parquet").write_bytes(b"x")
    assert release.verify(out, cache)


def test_release_refuses_a_bulk_file_that_is_not_the_one_read(setup):
    con, cache, tmp = setup
    (cache / "PMC1_PMC2.xml.gz").write_bytes(b"other")
    with pytest.raises(ValueError, match="not the"):
        release.release(con, tmp / "release", "t", cache, tmp / "ledger", partial=True)
    (cache / "PMC1_PMC2.xml.gz").unlink()
    with pytest.raises(ValueError, match="is not in"):
        release.release(con, tmp / "release", "t", cache, tmp / "ledger", partial=True)


def test_release_command_and_verify_flag(setup):
    con, cache, tmp = setup
    con.close()
    argv = ["release", "--db", str(tmp / "o.duckdb"), "--out", str(tmp / "release")]
    argv += ["--cache", str(cache), "--work", str(tmp / "ledger")]
    assert cli.main([*argv, "--partial"]) == 0
    assert cli.main([*argv, "--verify"]) == 0
    (cache / "PMC1_PMC2.xml.gz").write_bytes(b"changed")
    assert cli.main([*argv, "--verify"]) == 1


def test_verify_flags_a_stray_file(setup):
    con, cache, tmp = setup
    out = tmp / "release"
    release.release(con, out, "t", cache, tmp / "ledger", partial=True)
    (out / "data" / "stray.txt").write_text("not listed")
    problems = release.verify(out, cache)
    assert any("stray.txt" in p for p in problems)


def test_release_refuses_an_empty_inputs_list(setup):
    con, cache, tmp = setup
    con.execute("UPDATE units SET sha256 = NULL")
    with pytest.raises(ValueError, match="no finished unit"):
        release.release(con, tmp / "release", "t", cache, tmp / "ledger", partial=True)


def test_release_refuses_articles_from_an_unlisted_unit(setup):
    con, cache, tmp = setup
    con.execute("UPDATE articles SET source_unit = 'other.xml.gz' WHERE pmcid = 'PMC2'")
    with pytest.raises(ValueError, match=r"other\.xml\.gz"):
        release.release(con, tmp / "release", "t", cache, tmp / "ledger", partial=True)


def test_release_command_reports_failures_without_a_traceback(setup, capsys):
    con, cache, tmp = setup
    con.close()
    argv = ["release", "--db", str(tmp / "o.duckdb"), "--out", str(tmp / "release")]
    argv += ["--cache", str(cache), "--work", str(tmp / "ledger"), "--partial"]
    assert cli.main(argv) == 0
    assert cli.main(argv) == 1  # the output folder exists
    assert cli.main(["release", "--verify", "--out", str(tmp / "none"), "--cache", str(cache)]) == 1
    capsys.readouterr()


def test_statements_licence_names_every_version_the_rows_keep(setup):
    con, cache, tmp = setup
    out = tmp / "release"
    release.release(con, out, "t", cache, tmp / "ledger", partial=True)
    package = (out / "datapackage.json").read_text()
    assert "CC-BY-3.0" in package and "CC-BY-2.0" in package
