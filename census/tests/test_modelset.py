import json
import random
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import ClassVar

import pytest

from census import labels, modelset, store
from census.rows import Rows

CC_BY = "https://creativecommons.org/licenses/by/4.0/"


def tagged(i: int, statement: str, publisher: str = "P", year: int = 2024, license: str | None = CC_BY) -> Rows:
    article = {
        "pmcid": f"PMC{i}",
        "stratum": "all",
        "publisher": publisher,
        "year": year,
        "license": license,
        "style": "jats4r",
        "authors": ["Ann Smith", "Bo Jones"],
        "n_authors": 2,
        "statement": statement,
    }
    return Rows(article, roles=[(1, "software"), (2, "validation")], paired=[(1, "software")])


def corpus() -> list[Rows]:
    rows = [tagged(i, f"AS: software {i}. BJ: validation.", f"P{i % 3}", 2020 + i % 4) for i in range(400)]
    # One template text on 40 articles, spelled with different whitespace and case.
    rows += [
        tagged(1000 + i, "AS:  Software.\nBJ: validation." if i % 2 else "as: software. bj: VALIDATION.")
        for i in range(40)
    ]
    return rows


def make_db(path, rows):
    con = store.connect(path)
    store.insert(con, rows)
    return con


@pytest.fixture
def db(tmp_path):
    con = make_db(tmp_path / "m.duckdb", corpus())
    yield con
    con.close()


def test_split_is_deterministic_and_independent_of_row_order(db, tmp_path):
    shuffled = corpus()
    random.Random(1).shuffle(shuffled)
    with make_db(tmp_path / "s.duckdb", shuffled) as other:
        assert modelset.draw_split(db) == modelset.draw_split(other)
    assert modelset.draw_split(db, seed="other") != modelset.draw_split(db)


def test_split_keeps_identical_statements_together_and_holds_out_each_stratum(db):
    rows = modelset.draw_split(db)
    by_group: dict[str, set[str]] = {}
    for _, split, *_, group in rows:
        by_group.setdefault(group, set()).add(split)
    assert all(len(splits) == 1 for splits in by_group.values())
    template = {split for pmcid, split, *_ in rows if int(pmcid[3:]) >= 1000}
    assert len(template) == 1
    held = [r for r in rows if r[1] == "held_out" and int(r[0][3:]) < 1000]
    assert 16 <= len(held) <= 24  # 5% of 400 unique statements
    assert {(r[2], r[3]) for r in held} == {(f"P{i % 3}", 2020 + i % 4) for i in range(12)}


def test_split_manifest_is_pinned(db, tmp_path):
    path = tmp_path / "model" / "split.csv"
    modelset.write_split(modelset.draw_split(db), path)
    split = modelset.read_split(path)
    assert len(split) == 440 and set(split.values()) == {"train", "held_out"}
    with pytest.raises(FileExistsError):
        modelset.write_split([], path)


def test_dataset_marks_licence_and_carries_gold(tmp_path):
    with make_db(tmp_path / "d.duckdb", [tagged(1, "AS: software."), tagged(2, "x", license=None)]) as con:
        counts = modelset.write_dataset(con, {"PMC1": "train", "PMC2": "held_out"}, tmp_path / "ds")
    assert counts == {"held_out": 1, "train": 1}
    (train,) = modelset.read_jsonl(tmp_path / "ds" / "train.jsonl")
    (held,) = modelset.read_jsonl(tmp_path / "ds" / "held_out.jsonl")
    assert train["publishable"] is True and held["publishable"] is False
    assert train["authors"] == ["Ann Smith", "Bo Jones"]
    assert train["gold"] == [[1, "software"], [2, "validation"]]


def test_score_matches_the_label_set_scorer(db, tmp_path):
    db.execute("UPDATE articles SET style = 'plos_uri' WHERE pmcid IN ('PMC2', 'PMC3')")
    cells = {"PMC1": "1: software; 2: validation", "PMC2": "1: methodology", "PMC3": "none", "PMC4": "2: resources"}
    path = tmp_path / "labels.csv"
    path.write_text("pmcid,authors,text,gold\n" + "".join(f"{p},,x,{g}\n" for p, g in cells.items()))
    gold = {p: labels.parse_gold(g, 2) for p, g in cells.items()}
    # PMC1 exact, PMC2 one false positive, PMC3 nothing to find or predict, PMC4 no prediction.
    predicted = {"PMC1": gold["PMC1"], "PMC2": {(1, "methodology"), (2, "software")}, "PMC3": set()}
    (everything, *rows) = modelset.score(db, gold, predicted)
    assert rows == labels.score(db, path, predictions=predicted)
    assert everything[:6] == ("(all)", 4, 0.75, 0.75, 0.75, 0.5)
    assert rows[1][:6] == ("plos_uri", 2, 0.5, 1.0, 0.667, 0.5)


def test_rule_predictions_read_the_statement_not_the_tags(db):
    gold = modelset.held_out_gold(db, {"PMC1": "held_out", "PMC2": "train"})
    assert gold == {"PMC1": {(1, "software"), (2, "validation")}}
    assert modelset.rule_predictions(db, gold) == {"PMC1": {(1, "software")}}


class ChatServer(BaseHTTPRequestHandler):
    """A chat-completions endpoint that answers from `replies`, keyed by the statement it is sent:
    (content, finish_reason), or an HTTP error code."""

    replies: ClassVar[dict[str, tuple[str, str] | int]] = {}
    requests: ClassVar[list[dict]] = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        ChatServer.requests.append(body)
        reply = self.replies[body["messages"][1]["content"].split("<statement>\n")[1].split("\n")[0]]
        if isinstance(reply, int):
            self.send_error(reply)
            return
        content, finish = reply
        answer = {
            "choices": [{"message": {"content": content}, "finish_reason": finish}],
            "usage": {"prompt_tokens": 300, "completion_tokens": 40},
        }
        payload = json.dumps(answer).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        pass


@pytest.fixture
def server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), ChatServer)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    ChatServer.requests = []
    yield f"http://127.0.0.1:{httpd.server_port}/v1"
    httpd.shutdown()
    httpd.server_close()


def test_zero_shot_runner_resumes_and_handles_bad_answers(server, tmp_path, capsys):
    good = {"assignments": [{"author": 1, "roles": ["software"]}, {"author": 9, "roles": ["resources"]}]}
    ChatServer.replies = {
        "s0": (json.dumps(good), "stop"),
        "s1": ('{"assignments": [', "length"),  # cut off
        "s2": ("not json", "stop"),
        "s3": 500,  # nothing written, so the next run retries it
    }
    items = [{"pmcid": f"PMC{i}", "statement": f"s{i}", "authors": ["Ann Smith", "Bo Jones"]} for i in range(4)]
    out = tmp_path / "preds.jsonl"
    assert modelset.run_zero_shot(server, "m", items, out, limit=2, workers=4) == (2, 0)
    assert modelset.run_zero_shot(server, "m", items, out, limit=None, workers=4) == (1, 1)
    assert "PMC3" in capsys.readouterr().err
    assert modelset.read_predictions(out) == {"PMC0": {(1, "software")}, "PMC1": set(), "PMC2": set()}
    ChatServer.replies["s3"] = ('{"assignments": []}', "stop")
    assert modelset.run_zero_shot(server, "m", items, out, limit=None, workers=4) == (1, 0)
    assert len(ChatServer.requests) == 5
    body = ChatServer.requests[0]
    assert body["model"] == "m"
    assert body["response_format"]["json_schema"]["schema"] == modelset.SCHEMA
    assert "1. Ann Smith\n2. Bo Jones" in body["messages"][1]["content"]
