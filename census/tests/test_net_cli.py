import io
import json
import urllib.error
from email.message import Message
from http.client import IncompleteRead

import pytest

from census import cli, net, snapshot

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
        return io.BytesIO(item)


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


def test_cli_run_uses_the_committed_inventory_pin(tmp_path, monkeypatch):
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
