import io
import json
import urllib.error
import urllib.parse
from email.message import Message

import pytest
from test_modelset import make_db

from census import cli, labels, net, openalex, store
from census.rows import Rows

ROLE = "https://openalex.org/contributor-roles/"


def work(doi: str, *roles: list[str]) -> dict:
    """An OpenAlex work with one authorship per entry of `roles`, in byline order."""
    authors = [{"contributor_roles": [{"id": ROLE + slug} for slug in r]} for r in roles]
    return {"id": "https://openalex.org/W1", "doi": f"https://doi.org/{doi.upper()}", "authorships": authors}


class Api:
    """Stands in for urlopen: answers each DOI filter from `works`, or raises the queued errors first."""

    def __init__(self, works: dict[str, dict], *errors: BaseException):
        self.works, self.errors, self.urls = works, list(errors), []

    def __call__(self, request, timeout):
        self.urls.append(request.full_url)
        if self.errors:
            raise self.errors.pop(0)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
        found = [self.works[d] for d in query["filter"][0].removeprefix("doi:").split("|") if d in self.works]
        return io.BytesIO(json.dumps({"meta": {"count": len(found)}, "results": found}).encode())


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(net.time, "sleep", lambda s: None)
    monkeypatch.setattr(openalex.time, "sleep", lambda s: None)

    def install(works, *errors):
        fake = Api(works, *errors)
        monkeypatch.setattr(net.urllib.request, "urlopen", fake)
        return fake

    return install


WORKS = {
    "10.1/a": work("10.1/a", ["software", "editor"], ["writing-review-editing"]),
    "10.1/b": work("10.1/b", [], []),
    "10.1/c": work("10.1/c", ["software"]),
}


def test_fetch_asks_each_doi_once_and_keeps_the_key_out_of_messages(api, tmp_path, monkeypatch):
    monkeypatch.setattr(openalex, "BATCH", 2)
    fake = api(WORKS)
    cache = tmp_path / "roles.jsonl"
    assert openalex.fetch(["10.1/A", "https://doi.org/10.1/b", "10.1/c", "10.1/x", "10.1/a,b", ""], cache) == 2
    assert all("select=id%2Cdoi%2Cauthorships" in u and "per-page=2" in u for u in fake.urls)
    known = openalex.cached(cache)
    assert known["10.1/a"][2] == (2, [(1, "software"), (1, "editor"), (2, "writing-review-editing")])
    assert known["10.1/x"][2] is None  # asked, not in OpenAlex
    assert "10.1/a,b" not in known  # a comma would split the filter
    assert openalex.fetch(["10.1/a", "10.1/x"], cache) == 0  # all cached

    throttled = api({}, urllib.error.HTTPError("u", 429, "x", Message(), None))
    with pytest.raises(openalex.Stopped, match="HTTP 429") as error:
        openalex.fetch(["10.1/new"], cache, key="secret-key")
    assert len(throttled.urls) == 1  # a 429 stops at once, unretried
    assert "api_key=secret-key" in throttled.urls[0] and "secret" not in str(error.value)


def test_fetch_survives_a_half_line_from_a_killed_run(api, tmp_path):
    api(WORKS)
    cache = tmp_path / "roles.jsonl"
    cache.write_text('{"fetched": "2026-11-26", "dois": ["10.1/a"], "res', encoding="utf-8")
    assert openalex.fetch(["10.1/a"], cache) == 1
    assert openalex.cached(cache)["10.1/a"][2] is not None


def article(i: int, doi: str | None, n_authors: int, roles: list) -> Rows:
    fields = {"pmcid": f"PMC{i}", "stratum": "all", "style": "statement_text", "doi": doi, "n_authors": n_authors}
    return Rows(fields | {"statement": "text", "authors": [f"Author {n}" for n in range(n_authors)]}, roles=roles)


def test_write_maps_by_position_and_keeps_the_schema_pin(api, tmp_path):
    api(WORKS)
    cache = tmp_path / "roles.jsonl"
    openalex.fetch(["10.1/a", "10.1/b", "10.1/c", "10.1/x"], cache)
    db = tmp_path / "c.duckdb"
    make_db(db, [article(1, "10.1/a", 2, [])]).close()
    with store.connect(db) as con:
        articles = {"P1": ("10.1/a", 2), "P2": ("10.1/b", 2), "P3": ("10.1/c", 2), "P4": ("10.1/x", 1)}
        counts = openalex.write(con, articles | {"P5": (None, 1), "P6": ("10.1/y", 1)}, cache)
        rows = con.execute("SELECT * FROM openalex_assignments ORDER BY ALL").fetchall()
        meta = dict(con.execute("SELECT * FROM meta").fetchall())
    assert rows == [("P1", 1, "software"), ("P1", 2, "writing-review-editing")]
    assert counts == {
        "with roles": 1,
        "no roles": 1,
        "author count differs": 1,
        "not in OpenAlex": 1,
        "no askable DOI": 1,
        "not asked yet": 1,
        "pairs with a non-CRediT role (left out)": 1,
    }
    assert meta["openalex_roles_requests"] == "1" and meta["openalex_roles_fetched"]
    with store.connect(db) as con:  # a writer still accepts the database: the schema pin is unchanged
        assert store.mismatched_pins(con) == []


def test_paired_f1_differences_and_their_interval():
    gold = {"a": {(1, "software")}, "b": {(1, "software"), (2, "resources")}}
    systems = {"base": {"a": {(1, "software")}}, "same": {"a": {(1, "software")}}, "all": gold}
    rows = {r[0]: r for r in labels.paired_f1(gold, systems, ["a", "b"], "base", draws=200)}
    assert rows["base"] == ("base", 2, 1.0, 0.333, 0.5, None, None, None)
    assert rows["same"][5:] == (0.0, 0.0, 0.0)  # the same predictions on each resample
    assert rows["all"][4:6] == (1.0, 0.5) and rows["all"][6] <= 0.5 <= rows["all"][7]
    assert labels.paired_f1(gold, systems, [], "base")[0] == ("base", 0, None, None, None, None, None, None)


def test_cli_fetches_a_sheet_and_scores_gold_beside_the_census(api, tmp_path, capsys):
    api(WORKS)
    db, cache = tmp_path / "c.duckdb", tmp_path / "roles.jsonl"
    make_db(db, [article(1, "10.1/a", 2, [(1, "software")]), article(2, "10.1/b", 2, [])]).close()
    sheet = tmp_path / "set.csv"
    sheet.write_text("pmcid,authors,text\nPMC1,1. A | 2. B,x\nPMC2,1. A | 2. B,y\n", encoding="utf-8")
    assert cli.main(["openalex", str(sheet), "--db", str(db), "--cache", str(cache)]) == 0
    assert "1 no roles, 1 pairs with a non-CRediT role (left out), 1 with roles" in capsys.readouterr().out

    gold = tmp_path / "set-gold.jsonl"
    role = {"quote": "x", "mentions": [], "roles": [{"role": "writing - review & editing", "evidence": "named"}]}
    lines = [{"pmcid": "PMC1", "label": [role | {"authors": [2]}]}, {"pmcid": "PMC2", "label": []}]
    gold.write_text("".join(json.dumps(r) + "\n" for r in lines), encoding="utf-8")
    assert cli.main(["score", str(gold), "--db", str(db)]) == 0
    out = capsys.readouterr().out
    assert "set, OpenAlex has roles" in out and "model-made" in out
    assert next(line.split()[:5] for line in out.splitlines() if line.startswith("openalex")) == [
        "openalex",
        "2",
        "0.5",
        "1.0",
        "0.667",
    ]
    assert cli.main(["score", str(gold), "--db", str(db), "--key", str(sheet)]) == 1


def test_cli_exits_2_when_throttled(api, tmp_path, capsys):
    api({}, urllib.error.HTTPError("u", 429, "x", Message(), None))
    db = tmp_path / "c.duckdb"
    make_db(db, [article(1, "10.1/a", 2, [])]).close()
    assert cli.main(["openalex", "--all", "--db", str(db), "--cache", str(tmp_path / "r.jsonl")]) == 2
    assert "rerun to resume" in capsys.readouterr().err
