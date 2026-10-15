import gzip
import io
import json
import urllib.error
from email.message import Message
from http.client import IncompleteRead

import pytest

from census import cli, net, snapshot, store

URL = "https://example.invalid/x"


class Responses:
    """Stands in for urlopen: each call takes the next item, raising it if it is an exception."""

    def __init__(self, *items):
        self.items, self.calls = list(items), 0

    def __call__(self, request, timeout):
        self.calls += 1
        item = self.items.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item if isinstance(item, io.BytesIO) else io.BytesIO(item)


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("u", code, "x", Message(), None)


@pytest.fixture
def no_sleep(monkeypatch):
    monkeypatch.setattr(net.time, "sleep", lambda s: None)


def test_get_retries_throttling_and_cut_bodies(monkeypatch, no_sleep):
    responses = Responses(http_error(503), IncompleteRead(b"x"), b"body")
    monkeypatch.setattr(net.urllib.request, "urlopen", responses)
    assert net.get(URL) == b"body"
    assert responses.calls == 3


@pytest.mark.parametrize("code", [404, 403])
def test_get_raises_client_errors_at_once(monkeypatch, no_sleep, code):
    responses = Responses(http_error(code))
    monkeypatch.setattr(net.urllib.request, "urlopen", responses)
    with pytest.raises(urllib.error.HTTPError):
        net.get(URL)
    assert responses.calls == 1


class Short(io.BytesIO):
    """A response whose connection dropped before the length it announced."""

    length = 10


def test_get_retries_a_body_shorter_than_announced(monkeypatch, no_sleep):
    monkeypatch.setattr(net.urllib.request, "urlopen", Responses(Short(b"half"), b"body"))
    assert net.get(URL) == b"body"


def test_get_gives_up_on_a_trickle_past_the_deadline(monkeypatch, no_sleep):
    monkeypatch.setattr(net, "DEADLINE", -1)
    monkeypatch.setattr(net.urllib.request, "urlopen", Responses(*[b"slow"] * 5))
    with pytest.raises(TimeoutError):
        net.get(URL)


def test_download_streams_to_the_file_and_leaves_no_temp_on_failure(tmp_path, monkeypatch, no_sleep):
    monkeypatch.setattr(net.urllib.request, "urlopen", Responses(b"body", *[http_error(503)] * 5))
    net.download(URL, tmp_path / "ok")
    assert (tmp_path / "ok").read_bytes() == b"body"
    with pytest.raises(urllib.error.HTTPError):
        net.download(URL, tmp_path / "failed")
    assert [p.name for p in tmp_path.iterdir()] == ["ok"]


def test_get_gives_up_after_its_retries(monkeypatch, no_sleep):
    responses = Responses(*[http_error(503)] * 5)
    monkeypatch.setattr(net.urllib.request, "urlopen", responses)
    with pytest.raises(urllib.error.HTTPError):
        net.get(URL)
    assert responses.calls == 5


def test_search_ids_pages_until_the_cursor_repeats(monkeypatch):
    pages = [
        {"resultList": {"result": [{"pmcid": "PMC1"}, {"pmcid": "../x"}, {}]}, "nextCursorMark": "a"},
        {"resultList": {"result": [{"pmcid": "PMC2"}]}, "nextCursorMark": "a"},
    ]
    monkeypatch.setattr(snapshot, "get", lambda url: json.dumps(pages.pop(0)).encode())
    assert snapshot.search_ids("q", 10) == ["PMC1", "PMC2"]  # the malformed id is dropped


def test_draw_is_seeded(monkeypatch):
    monkeypatch.setattr(snapshot, "search_ids", lambda q, limit: [f"PMC{i}" for i in range(100)])
    first = snapshot.draw(2, 7)
    assert first == snapshot.draw(2, 7)
    assert len(first) == 2 * len(snapshot.STRATA) * len(snapshot.YEARS)


def test_cli_failures_are_one_line(tmp_path, capsys):
    assert cli.main(["run", "--snapshot", "nope"]) == 1
    assert "no manifest" in capsys.readouterr().err
    assert cli.main(["report", "--db", str(tmp_path / "missing.duckdb")]) == 1
    assert "no database" in capsys.readouterr().err
    assert cli.main(["run", "--inventory", "x'; DROP"]) == 1
    assert "not a date" in capsys.readouterr().err


def test_commands_after_a_bulk_run_default_to_its_database(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(cli, "DATA", tmp_path)
    for command in ("fields", "report", "export", "label"):
        assert cli.main([command]) == 1
        assert "oa-2026-10.duckdb" in capsys.readouterr().err


def test_report_warns_on_a_database_from_another_parser(tmp_path, monkeypatch, capsys):
    db = tmp_path / "r.duckdb"
    store.connect(db).close()
    monkeypatch.setattr(store, "PARSER_VERSION", "changed")
    assert cli.main(["report", "--db", str(db)]) == 0
    assert "warning:" in capsys.readouterr().err
    assert cli.main(["fields", "--db", str(db)]) == 1  # a writer refuses
    assert "rerun with --fresh" in capsys.readouterr().err


def test_bulk_fails_a_file_that_differs_from_its_pinned_hash(tmp_path, monkeypatch, capsys):
    snapshots, cache = tmp_path / "snapshots", tmp_path / "bulk"
    snapshots.mkdir()
    cache.mkdir()
    (cache / "PMC1_PMC9.xml.gz").write_bytes(gzip.compress(b"<articles/>"))
    (cache / "PMC1_PMC9.xml.gz.123.456.tmp").write_bytes(b"half")  # left by a killed run
    pin = "unit,listed_date,sha256\nPMC1_PMC9.xml.gz,2026-10-03 04:02," + "ab" * 32 + "\n"
    (snapshots / "s.files.csv").write_text(pin, encoding="utf-8")
    monkeypatch.setattr(cli, "SNAPSHOTS", snapshots)
    args = ["bulk", "--snapshot", "s", "--db", str(tmp_path / "b.duckdb"), "--cache", str(cache), "--processes", "0"]
    assert cli.main(args) == 2
    err = capsys.readouterr().err
    assert "PMC1_PMC9.xml.gz: sha256" in err and "1 units unfinished" in err
    assert (snapshots / "s.files.csv").read_text(encoding="utf-8") == pin
    assert [p.name for p in cache.iterdir()] == ["PMC1_PMC9.xml.gz"]


def test_cli_run_uses_the_committed_inventory_pin(tmp_path, monkeypatch, capsys):
    snapshots = tmp_path / "snapshots"
    snapshots.mkdir()
    snapshot.write_manifest([{"pmcid": "PMC1", "stratum": "all", "year": ""}], snapshots / "s.csv")
    (snapshots / "s.inventory").write_text("2026-10-12T01-00Z\n")
    monkeypatch.setattr(cli, "SNAPSHOTS", snapshots)
    monkeypatch.setattr(cli, "DATA", tmp_path / "data")
    monkeypatch.setattr(cli.pmc_s3, "latest_inventory", lambda: pytest.fail("must not look up the newest"))
    seen = {}
    monkeypatch.setattr(cli.pmc_s3, "load_versions", lambda date, cache: seen.setdefault("date", date) and {})
    monkeypatch.setattr(cli.pipeline, "run", lambda *a, **k: {"missing": 1})
    assert cli.main(["run", "--snapshot", "s", "--db", str(tmp_path / "s.duckdb")]) == 0
    assert seen["date"] == "2026-10-12T01-00Z"
    assert (snapshots / "s.inventory").read_text() == "2026-10-12T01-00Z\n"  # untouched
    assert (
        cli.main(["run", "--snapshot", "s", "--db", str(tmp_path / "s.duckdb"), "--inventory", "2026-10-13T01-00Z"])
        == 1
    )
    assert "pinned to inventory 2026-10-12T01-00Z" in capsys.readouterr().err
