import io
import json
import urllib.error
import urllib.parse
from email.message import Message

import duckdb
import pytest
from test_modelset import make_db

from census import cli, labels, net, openalex, store
from census.rows import Rows

ROLE = "https://openalex.org/contributor-roles/"


def work(doi: str, *roles: list[str]) -> dict:
    """An OpenAlex work with one authorship per entry of `roles`, in byline order."""
    authors = [{"contributor_roles": [{"id": ROLE + slug} for slug in r]} for r in roles]
    return {"id": "https://openalex.org/W1", "doi": f"https://doi.org/{doi.upper()}", "authorships": authors}


def http_error(code: int, **headers: str) -> urllib.error.HTTPError:
    message = Message()
    for name, value in headers.items():
        message[name.replace("_", "-")] = value
    return urllib.error.HTTPError("u", code, "x", message, None)


class Api:
    """Stands in for urlopen: answers each DOI filter from `works`, or first the queued errors and bodies.

    A filter holding a DOI in `refused` answers HTTP 400; `hidden` works count in meta but stay off the page.
    A queued exception is raised, anything else is sent as the JSON body.
    """

    def __init__(self, works: dict[str, dict], *queued, refused=(), hidden=0):
        self.works, self.queued, self.urls = works, list(queued), []
        self.refused, self.hidden = set(refused), hidden

    def __call__(self, request, timeout):
        self.urls.append(request.full_url)
        if self.queued:
            first = self.queued.pop(0)
            if isinstance(first, BaseException):
                raise first
            return io.BytesIO(json.dumps(first).encode())
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
        dois = query["filter"][0].removeprefix("doi:").split("|")
        if self.refused & set(dois):
            raise urllib.error.HTTPError("u", 400, "bad filter", Message(), None)
        found = [self.works[d] for d in dois if d in self.works]
        return io.BytesIO(json.dumps({"meta": {"count": len(found) + self.hidden}, "results": found}).encode())


@pytest.fixture
def sleeps(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr(openalex.time, "sleep", slept.append)  # the same `time` module as net's
    return slept


@pytest.fixture
def api(monkeypatch, sleeps):
    def install(works, *queued, **options):
        fake = Api(works, *queued, **options)
        monkeypatch.setattr(net.urllib.request, "urlopen", fake)
        return fake

    return install


def line(dois: list[str], works: list, fetched: str = "2026-11-26") -> str:
    """A cache line, `works` as (DOI, author count, pairs)."""
    return json.dumps({"fetched": fetched, "dois": dois, "works": works}) + "\n"


WORKS = {
    "10.1/a": work("10.1/a", ["software", "editor"], ["writing-review-editing"]),
    "10.1/b": work("10.1/b", [], []),
    "10.1/c": work("10.1/c", ["software"]),
}


def test_fetch_asks_each_doi_once_and_keeps_the_key_out_of_messages(api, tmp_path, monkeypatch, sleeps):
    monkeypatch.setattr(openalex, "BATCH", 2)
    fake = api(WORKS)
    cache = tmp_path / "roles.jsonl"
    dois = ["10.1/A", "https://doi.org/10.1/b", "10.1/c", "10.1/x", "10.1/a,b", "10.1/a|b", ""]
    assert openalex.fetch(dois, cache) == 2
    assert sleeps == [openalex.PAUSE]  # paced between requests, not before the first
    assert all("select=id%2Cdoi%2Cauthorships" in u and "per-page=2" in u for u in fake.urls)
    known = openalex.cached(cache)
    assert known["10.1/a"][2] == (2, [(1, "software"), (1, "editor"), (2, "writing-review-editing")])
    assert known["10.1/x"][2] is None  # asked, not in OpenAlex
    assert "10.1/a,b" not in known and "10.1/a|b" not in known  # a comma or a bar would split the filter
    assert "authorships" not in cache.read_text()  # only what `write` needs is kept
    assert openalex.fetch(["10.1/a", "10.1/x"], cache) == 0  # all cached

    stopped = api({}, http_error(401))  # OpenAlex's answer to a bad key
    with pytest.raises(openalex.Stopped, match="HTTP 401") as error:
        openalex.fetch(["10.1/new"], cache, key="secret-key")
    assert len(stopped.urls) == 1 and "10.1/new" not in openalex.cached(cache)
    assert "api_key=secret-key" in stopped.urls[0] and "secret" not in str(error.value)


def test_fetch_waits_out_a_few_throttles_then_stops(api, tmp_path, sleeps):
    cache = tmp_path / "roles.jsonl"
    fake = api(WORKS, http_error(429, Retry_After="7"), http_error(429))
    assert openalex.fetch(["10.1/a"], cache) == 3
    assert len(fake.urls) == 3 and openalex.cached(cache)["10.1/a"][2] is not None
    assert sleeps == [7.0, openalex.PAUSE, 120.0, openalex.PAUSE]  # Retry-After, else 60 s doubling per throttle

    fake = api(WORKS, *(http_error(429) for _ in range(openalex.THROTTLES + 1)))
    sleeps.clear()
    with pytest.raises(openalex.Stopped, match="HTTP 429"):
        openalex.fetch(["10.1/c"], cache)
    assert len(fake.urls) == openalex.THROTTLES + 1 and "10.1/c" not in openalex.cached(cache)
    assert [s for s in sleeps if s != openalex.PAUSE] == [60.0, 120.0, 240.0, 480.0, 960.0]


def test_fetch_counts_throttles_in_a_row_only(api, tmp_path, monkeypatch):
    monkeypatch.setattr(openalex, "BATCH", 1)
    throttles = [http_error(429) for _ in range(openalex.THROTTLES)]
    answer = {"meta": {"count": 1}, "results": [WORKS["10.1/a"]]}
    fake = api(WORKS, *throttles, answer, *throttles)
    assert openalex.fetch(["10.1/a", "10.1/c"], tmp_path / "roles.jsonl") == 2 * openalex.THROTTLES + 2
    assert len(fake.urls) == 2 * openalex.THROTTLES + 2


@pytest.mark.parametrize(
    "body",
    [
        [],
        None,
        {"meta": {"count": 1}},
        {"meta": {"count": 1}, "results": [{"doi": "10.1/a", "authorships": [{"contributor_roles": [{"id": None}]}]}]},
        {"meta": {"count": 1}, "results": [{"doi": 7, "authorships": []}]},
        {"results": []},
    ],
)
def test_fetch_stops_on_an_answer_of_another_shape_and_writes_nothing(api, tmp_path, body):
    cache = tmp_path / "roles.jsonl"
    cache.write_text(line(["10.1/b"], []), encoding="utf-8")
    before = cache.read_text()
    api(WORKS, body)
    with pytest.raises(openalex.Stopped, match="request failed"):
        openalex.fetch(["10.1/a"], cache)
    assert cache.read_text() == before


def test_fetch_survives_a_half_line_from_a_killed_run(api, tmp_path):
    api(WORKS)
    cache = tmp_path / "roles.jsonl"
    cache.write_text('{"fetched": "2026-11-26", "dois": ["10.1/a"], "wor', encoding="utf-8")
    assert openalex.fetch(["10.1/a"], cache) == 1
    assert openalex.cached(cache)["10.1/a"][2] is not None


def test_cached_skips_a_line_cut_inside_a_multibyte_character(tmp_path):
    cache = tmp_path / "roles.jsonl"
    cut = '{"fetched": "2026-11-26", "dois": ["10.1/b"], "works": [["10.1/zoë'.encode()[:-1]
    cache.write_bytes(line(["10.1/a"], []).encode() + cut)
    assert list(openalex.cached(cache)) == ["10.1/a"]


def test_fetch_asks_a_refused_batch_one_doi_at_a_time(api, tmp_path, monkeypatch):
    monkeypatch.setattr(openalex, "BATCH", 2)
    fake = api(WORKS, http_error(414), refused={"10.1/bad"})
    cache = tmp_path / "roles.jsonl"
    # Batches: [a, b], [bad, c], both refused (414, then 400) and asked again one DOI at a time.
    assert openalex.fetch(["10.1/a", "10.1/b", "10.1/bad", "10.1/c"], cache) == 6
    assert len(fake.urls) == 6
    known = openalex.cached(cache)
    assert known["10.1/bad"][2] is None and known["10.1/c"][2] is not None
    assert openalex.fetch(["10.1/bad"], cache) == 0  # recorded, so a rerun goes past it


def test_fetch_asks_again_for_dois_an_overflowing_page_left_out(api, tmp_path):
    api(WORKS, hidden=1)
    cache = tmp_path / "roles.jsonl"
    openalex.fetch(["10.1/a", "10.1/x"], cache)
    assert list(openalex.cached(cache)) == ["10.1/a"]  # 10.1/x may be on the page not sent
    api(WORKS)
    assert openalex.fetch(["10.1/a", "10.1/x"], cache) == 1


def test_cached_takes_another_version_only_when_it_is_the_only_one(tmp_path):
    cache = tmp_path / "roles.jsonl"
    lines = [
        line(["10.7554/elife.89892"], [["10.7554/elife.89892.3", 1, [[1, "software"]]]]),
        line(["10.1/v.1"], [["10.1/v.2", 1, [[1, "resources"]]]]),
        line(["10.1/e"], [["10.1/e.1", 0, []], ["10.1/e.2", 0, []]]),
        line(["10.1371/journal.pone"], [["10.1371/journal.pone.0123456", 0, []]]),
    ]
    cache.write_text("".join(lines), encoding="utf-8")
    known = openalex.cached(cache)
    assert known["10.7554/elife.89892"][2] == (1, [(1, "software")])
    assert known["10.1/v.1"][2] == (1, [(1, "resources")])  # a later version answers, on purpose
    assert known["10.1/e"][2] is None  # two versions came back: neither is taken
    assert known["10.1371/journal.pone"][2] is None  # a seven-digit article id is not a version
    assert openalex.unversioned("10.1/x/v2") == "10.1/x"


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
    api(WORKS | {"10.1/x": work("10.1/x", ["software"])})
    cache.unlink()
    openalex.fetch(["10.1/a", "10.1/x"], cache)
    with store.connect(db) as con:  # a second write replaces the rows of the articles it is given
        con.execute("INSERT INTO openalex_assignments VALUES ('P9', 1, 'resources')")
        openalex.write(con, {"P1": ("10.1/a", 2), "P4": ("10.1/x", 1)}, cache)
        rows = con.execute("SELECT * FROM openalex_assignments ORDER BY ALL").fetchall()
    assert rows == [
        ("P1", 1, "software"),
        ("P1", 2, "writing-review-editing"),
        ("P4", 1, "software"),
        ("P9", 1, "resources"),
    ]


def test_write_records_the_oldest_fetch_date_and_the_lines_of_this_write(tmp_path):
    cache = tmp_path / "roles.jsonl"
    old = line(["10.1/a"], [["10.1/a", 1, [[1, "software"]]]], "2026-11-01")
    cache.write_text(line(["10.1/b"], [], "2026-11-20") + old + line(["10.1/c"], [], "2026-11-02"), encoding="utf-8")
    db = tmp_path / "c.duckdb"
    make_db(db, [article(1, "10.1/a", 1, [])]).close()
    with store.connect(db) as con:
        openalex.write(con, {"P1": ("10.1/a", 1), "P2": ("10.1/b", 1)}, cache)
        meta = dict(con.execute("SELECT * FROM meta").fetchall())
    assert (meta["openalex_roles_fetched"], meta["openalex_roles_requests"]) == ("2026-11-01", "2")


def test_paired_f1_differences_and_their_interval():
    gold = {"a": {(1, "software")}, "b": {(1, "software"), (2, "resources")}}
    systems = {"base": {"a": {(1, "software")}}, "same": {"a": {(1, "software")}}, "all": gold}
    rows = {r[0]: r for r in labels.paired_f1(gold, systems, ["a", "b"], "base", draws=200)}
    assert rows["base"] == ("base", 2, 1.0, 0.333, 0.5, None, None, None)
    assert rows["same"][5:] == (0.0, 0.0, 0.0)  # the same predictions on each resample
    assert rows["all"][4:6] == (1.0, 0.5) and rows["all"][6] <= 0.5 <= rows["all"][7]
    ids = [str(i) for i in range(10)]
    gold = {i: {(n, "software") for n in range(1, int(i) + 2)} for i in ids}
    half = {"base": {i: {(n, "software") for n in range(1, int(i) // 2 + 2)} for i in ids}, "all": gold}
    # The seeded percentiles: about one seed in twenty draws these bounds, and the extremes lie wider.
    assert labels.paired_f1(gold, half, ids, "base", draws=200)[1] == ("all", 10, 1.0, 1.0, 1.0, 0.294, 0.257, 0.319)
    assert labels.paired_f1(gold, systems, [], "base")[0] == ("base", 0, None, None, None, None, None, None)


def tables(out: str) -> dict[str, dict[str, list[str]]]:
    """Each printed table's title -> system -> (articles, precision, recall, F1)."""
    found = {}
    for block in out.split("\n\n"):
        head, *rows = block.strip().splitlines()
        found[head[:40].strip()] = {r[:40].strip(): r[40:].split()[:4] for r in rows}
    return found


def test_cli_fetches_a_sheet_and_scores_gold_beside_the_census(api, tmp_path, capsys):
    api(WORKS)
    db, cache = tmp_path / "c.duckdb", tmp_path / "roles.jsonl"
    make_db(db, [article(1, "10.1/a", 2, [(1, "software")]), article(2, "10.1/b", 2, [])]).close()
    sheet = tmp_path / "set.csv"
    sheet.write_text("pmcid,authors,text\nPMC1,1. A | 2. B,x\nPMC2,1. A | 2. B,y\n", encoding="utf-8")
    gold = tmp_path / "set-gold.jsonl"
    named = {"quote": "x", "mentions": []}
    lines = [
        {
            "pmcid": "PMC1",
            "label": [named | {"authors": [2], "roles": [{"role": "writing - review & editing", "evidence": "named"}]}],
        },
        {"pmcid": "PMC2", "label": [named | {"authors": [1], "roles": [{"role": "software", "evidence": "named"}]}]},
    ]
    gold.write_text("".join(json.dumps(r) + "\n" for r in lines), encoding="utf-8")
    assert cli.main(["score", str(gold), "--db", str(db)]) == 1  # nothing fetched yet
    assert "census openalex" in capsys.readouterr().err

    assert cli.main(["openalex", str(sheet), "--db", str(db), "--cache", str(cache)]) == 0
    assert "1 no roles, 1 pairs with a non-CRediT role (left out), 1 with roles" in capsys.readouterr().out
    with duckdb.connect(str(db)) as con:  # the encoder reads PMC1, so the census differs from the rules
        con.execute("CREATE TABLE encoder_assignments (pmcid VARCHAR, author_position INTEGER, role VARCHAR)")
        con.execute("INSERT INTO encoder_assignments VALUES ('PMC1', 2, 'writing-review-editing')")
    predictions = tmp_path / "zs.jsonl"
    predictions.write_text(json.dumps({"pmcid": "PMC2", "pairs": [[1, "software"]]}) + "\n", encoding="utf-8")
    two = tmp_path / "two-gold.jsonl"
    two.write_text(json.dumps(lines[1]) + "\n", encoding="utf-8")
    assert cli.main(["score", str(gold), str(two), "--db", str(db), "--predictions", str(predictions)]) == 0
    out = capsys.readouterr().out
    assert "model-made" in out
    found = tables(out)
    every = {
        "openalex": ["2", "0.5", "0.5", "0.5"],
        "rule parser": ["2", "0.0", "0.0", "0.0"],
        "census as published": ["2", "1.0", "0.5", "0.667"],
        "zs": ["2", "1.0", "0.5", "0.667"],
    }
    assert found["set, all articles"] == found["pooled, all articles"] == every
    assert found["set, OpenAlex has roles"] == {
        "openalex": ["1", "0.5", "1.0", "0.667"],
        "rule parser": ["1", "0.0", "0.0", "0.0"],
        "census as published": ["1", "1.0", "1.0", "1.0"],
        "zs": ["1", "-", "0.0", "0.0"],
    }
    assert found["two, all articles"]["openalex"] == ["1", "-", "0.0", "0.0"]
    assert cli.main(["score", str(gold), "--db", str(db), "--key", str(sheet)]) == 1

    ood = tmp_path / "ood-gold.jsonl"  # a set outside the database leaves the others their census rows
    ood.write_text(json.dumps({"pmcid": "PMC99", "label": []}) + "\n", encoding="utf-8")
    assert cli.main(["score", str(gold), str(ood), "--db", str(db)]) == 0
    captured = capsys.readouterr()
    found = tables(captured.out)
    assert "rule parser" in found["set, all articles"]
    assert set(found["ood, all articles"]) == set(found["pooled, all articles"]) == {"openalex"}
    assert "ood: 1 articles are not in the database" in captured.err


def test_cli_score_refuses_what_it_cannot_score(tmp_path, capsys):
    db = tmp_path / "c.duckdb"
    make_db(db, [article(1, "10.1/a", 2, [])]).close()
    csv, bad = tmp_path / "set.csv", tmp_path / "bad-gold.jsonl"
    csv.write_text("pmcid\n", encoding="utf-8")
    bad.write_text('{"label": []}\n', encoding="utf-8")
    cases = {
        (str(csv), str(bad)): "not both",
        (str(csv), str(csv)): "one label CSV at a time",
        (str(tmp_path / "missing-gold.jsonl"),): "cannot read gold file",
        (str(bad),): "cannot read gold file",
    }
    for files, message in cases.items():
        assert cli.main(["score", *files, "--db", str(db)]) == 1
        assert message in capsys.readouterr().err


def test_cli_all_asks_only_articles_with_census_roles_and_exits_2_when_throttled(api, tmp_path, capsys):
    db, cache = tmp_path / "c.duckdb", tmp_path / "r.jsonl"
    make_db(db, [article(1, "10.1/a", 2, [(1, "software")]), article(2, "10.1/b", 2, [])]).close()
    api({}, *(http_error(429) for _ in range(openalex.THROTTLES + 1)))
    assert cli.main(["openalex", "--all", "--db", str(db), "--cache", str(cache)]) == 2
    assert "rerun to resume" in capsys.readouterr().err
    fake = api(WORKS)
    assert cli.main(["openalex", "--all", "--db", str(db), "--cache", str(cache)]) == 0
    assert [urllib.parse.parse_qs(urllib.parse.urlsplit(u).query)["filter"] for u in fake.urls] == [["doi:10.1/a"]]
    assert cli.main(["openalex", "--all", str(tmp_path / "set.csv"), "--db", str(db)]) == 1
