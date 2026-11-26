import json

import pytest
from test_encoder import WordTokenizer, tiny_model, tiny_run

from census import encoder, modelset, onepass, runinfo

CLS, SEP, M = 1, 2, 99


def test_one_chunk_marks_each_author_before_the_statement():
    (chunk,) = onepass.chunks([[5, 6], [7]], [8, 8, 8], 40, CLS, SEP, M, row=3)
    assert chunk.ids == [CLS, M, 5, 6, M, 7, SEP, 8, 8, 8, SEP]
    assert chunk.markers == [1, 4] and [chunk.ids[p] for p in chunk.markers] == [M, M]
    assert chunk.authors == [0, 1] and chunk.row == 3
    assert onepass.chunks([], [8], 40, CLS, SEP, M) == []


def test_a_long_byline_splits_into_chunks_that_repeat_the_statement():
    authors = [[10 + i] * 3 for i in range(5)]  # 4 tokens each with its marker
    statement = [8] * 9
    made = onepass.chunks(authors, statement, 20, CLS, SEP, M)  # room for 8 author tokens: 2 authors per chunk
    assert [c.authors for c in made] == [[0, 1], [2, 3], [4]]
    for c in made:
        assert len(c.ids) <= 20 and c.ids[-len(statement) - 2 :] == [SEP, *statement, SEP]
        assert [c.ids[p + 1] for p in c.markers] == [10 + i for i in c.authors]


def test_a_long_statement_is_cut_to_leave_room_for_its_authors():
    made = onepass.chunks([[5] * 4, [6]], [8] * 100, 32, CLS, SEP, M)  # the whole byline fits in 7
    assert len(made) == 1 and len(made[0].ids) == 32 and made[0].ids.count(8) == 32 - 3 - 7
    runaway = onepass.chunks([[5] * 50], [8] * 100, 32, CLS, SEP, M)  # an author cut at a quarter
    assert runaway[0].ids[:10] == [CLS, M, *[5] * 8] and len(runaway[0].ids) == 32
    # Near max_length, a quarter goes to authors: 5 per chunk here, not 1.
    many = onepass.chunks([[5]] * 10, [8] * 100, 40, CLS, SEP, M)
    assert [len(c.authors) for c in many] == [5, 5] and all(len(c.ids) == 40 for c in many)
    assert onepass.statement_room([[5]] * 10, 40) == 27


def test_per_article_puts_chunk_rows_back_in_byline_order():
    made = onepass.chunks([[5]] * 3, [8], 6, CLS, SEP, M)  # room for one author per chunk
    assert len(made) == 3
    probs = [[[float(c.authors[0])] * 14] for c in made]
    (article,) = onepass.per_article([3], made, probs)
    assert [row[0] for row in article] == [0.0, 1.0, 2.0]


class MarkerTokenizer(WordTokenizer):
    unk_token_id = 3

    def convert_tokens_to_ids(self, token):
        return M if token == onepass.MARKER else self.unk_token_id


def test_encoded_uses_author_text_and_flags_cut_articles():
    rows = [
        {"statement": "aa bbb", "authors": ["Ann Smith", "Bo Jones"]},
        {"statement": " ".join(["x"] * 60), "authors": ["Cy Li"]},
        {"statement": "s", "authors": [f"Name {i}" for i in range(6)]},
    ]
    encoded = onepass.Encoded(MarkerTokenizer(), rows, max_length=40)
    first = encoded.chunks[0]
    tokens = WordTokenizer()([encoder.author_text("Ann Smith", 1, 2)])["input_ids"][0]
    assert first.ids[first.markers[0] + 1 : first.markers[1]] == tokens
    assert encoded.truncated == {1}
    assert sum(c.row == 2 for c in encoded.chunks) == 2  # six authors do not fit one chunk
    with pytest.raises(ValueError, match="vocabulary"):
        onepass.Encoded(MarkerTokenizer(), rows, 40, marker="[nope]")


def test_a_statement_that_just_fits_is_not_flagged_as_cut():
    (author,) = WordTokenizer()([encoder.author_text("Cy Li", 1, 1)])["input_ids"]
    room = onepass.statement_room([author], 40)
    for words, cut in [(room, set()), (room + 1, {0})]:
        rows = [{"statement": " ".join(["x"] * words), "authors": ["Cy Li"]}]
        assert onepass.Encoded(MarkerTokenizer(), rows, max_length=40).truncated == cut


def test_train_predict_and_export_on_a_tiny_model(tmp_path):
    pytest.importorskip("onnxruntime")
    tiny_model(tmp_path / "tiny")
    # The tiny vocabulary has no [unused0]; [MASK] stands in as the marker.
    dataset = tmp_path / "dataset"
    dataset.mkdir()
    rows = [
        {
            "pmcid": f"PMC{i}",
            "publisher": "P",
            "style": "jats4r",
            "statement": f"{i} software validation",
            # 1, 3 and 5 authors, so a batch pads marker_positions to its longest byline.
            "authors": ["Ann Smith", "Bo Jones", "Cy Li", "Di Ng", "Ed Oh"][: 1 + 2 * (i % 3)],
            "gold": [[1, "software"], [2, "validation"]] if i % 3 else [[1, "software"]],
        }
        for i in range(40)
    ]
    (dataset / "train.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    config = onepass.Config(
        model=str(tmp_path / "tiny"), train_articles=30, dev_every=4, batch_size=8, device="cpu", marker="[MASK]"
    )
    run = tmp_path / "run"
    best = onepass.train(config, dataset, run)
    assert str(best["threshold"]) in map(str, encoder.THRESHOLDS)
    probs = onepass.reader(run, "cpu")[0](rows[:2])[0]
    assert [len(a) for a in probs] == [1, 3] and all(len(p) == 14 for a in probs for p in a)

    import onnxruntime as ort
    from transformers import AutoTokenizer

    from census import browser

    out = tmp_path / "browser"
    assert set(onepass.export(run, out)) == {"fp32", "w8"}
    assert json.loads((out / "run.json").read_text())["init"] == ""
    session = ort.InferenceSession(str(tmp_path / "browser" / "onnx" / "model.onnx"))
    assert [i.name for i in session.get_inputs()] == ["input_ids", "attention_mask", "marker_positions"]
    encoded = onepass.Encoded(AutoTokenizer.from_pretrained(run / "checkpoint"), rows[:2], 512, "[MASK]")
    from_onnx = onepass.onnx_probabilities(session, encoded, 4)
    assert from_onnx[1][2] == pytest.approx(probs[1][2], abs=1e-4)
    w8 = ort.InferenceSession(str(tmp_path / "browser" / "onnx" / "model_w8.onnx"))
    assert onepass.onnx_probabilities(w8, encoded, 1)[1][0] == pytest.approx(probs[1][0], abs=0.02)
    cases = onepass.parity(tmp_path / "browser")
    written = json.loads((tmp_path / "browser" / "parity.json").read_text())
    assert written["model"]["marker"] == "[MASK]" and len(written["cases"]) == len(onepass.PARITY_CASES)
    w8_sha256 = runinfo.sha256(out / "onnx" / "model_w8.onnx")
    assert written["model"]["sha256"] == {
        "tokenizer.json": runinfo.sha256(out / "tokenizer.json"),
        "onnx/model_w8.onnx": w8_sha256,
    }
    long = next(c for c in cases if c["case"].startswith("25 authors"))
    assert [a for c in long["chunks"] for a in c["authors"]] == list(range(1, 26))
    assert all(len(c["logits"]) == len(c["marker_positions"]) for c in long["chunks"])
    results = browser.evaluate(out, [{**r, "gold": r["gold"]} for r in rows[:4]], threads=1)
    assert set(results) == {"fp32", "w8"} and results["fp32"]["same_as_fp32"] == 1.0
    for name in browser.HUB_EXPORT:
        assert (out / name).exists(), name
    (run / "card.md").write_text("card")
    files = browser.hub_files(run, out, run / "card.md", {}, {})
    assert "onnx/model_w8.onnx" in files and len(files) == len(browser.HUB_EXPORT) + 2

    # The prediction writers read the run.
    import pyarrow.parquet as pq

    items = [*rows[:3], {"pmcid": "PMC99", "statement": "x", "authors": []}]
    assert encoder.predict(run, items, tmp_path / "preds.jsonl", "cpu") == 4
    predicted = modelset.read_predictions(tmp_path / "preds.jsonl")
    assert set(predicted) == {"PMC0", "PMC1", "PMC2", "PMC99"} and predicted["PMC99"] == set()
    assert encoder.predict_corpus(run, [items[:2], items[2:]], tmp_path / "parts", "cpu", total=4) == 4
    table = pq.read_table(tmp_path / "parts").to_pylist()
    assert {r["pmcid"] for r in table} == set(predicted)
    assert {(r["author_position"], r["role"]) for r in table if r["pmcid"] == "PMC1"} == predicted["PMC1"]


def test_train_on_open_licences_only(tmp_path):
    tiny_model(tmp_path / "tiny")
    dataset = tmp_path / "dataset"
    dataset.mkdir()
    rows = [
        {
            "pmcid": f"PMC{i}",
            "publisher": "P",
            "style": "jats4r",
            "publishable": i % 4 != 0,
            "statement": f"{i} software",
            "authors": ["Ann Smith"],
            "gold": [[1, "software"]],
        }
        for i in range(40)
    ]
    (dataset / "train.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    config = onepass.Config(
        model=str(tmp_path / "tiny"),
        train_articles=100,
        dev_every=4,
        epochs=1,
        device="cpu",
        open_licence_only=True,
        marker="[MASK]",
    )
    onepass.train(config, dataset, tmp_path / "run")
    first = json.loads((tmp_path / "run" / "metrics.jsonl").read_text().splitlines()[0])
    assert first["train_articles"] + first["dev_articles"] == 30


def test_predict_corpus_writes_parts_and_resumes(tmp_path):
    run = tmp_path / "run"
    tiny_run(run)  # threshold 0: every role, so every author gets 14 rows
    import pyarrow.parquet as pq

    items = [{"pmcid": f"PMC{i}", "statement": "software", "authors": ["Ann Smith"] * (i % 2)} for i in range(5)]
    chunks = [items[:2], items[2:4], items[4:]]
    out = tmp_path / "parts"
    assert encoder.predict_corpus(run, chunks, out, "cpu", total=5) == 5
    rows = pq.read_table(out).to_pylist()
    assert sorted({r["pmcid"] for r in rows}) == [f"PMC{i}" for i in range(5)]
    assert sum(r["pmcid"] == "PMC1" for r in rows) == 14
    assert [r["role"] for r in rows if r["pmcid"] == "PMC0"] == [None]  # no authors, still listed
    (out / "part-00001.parquet").unlink()
    assert encoder.predict_corpus(run, chunks, out, "cpu", total=5) == 2  # only the missing part
    with pytest.raises(ValueError, match="other articles than chunk 0"):  # resumed with another chunk size
        encoder.predict_corpus(run, [items[:3], items[3:]], out, "cpu", total=5)


def test_cli_train_refuses_init_without_a_checkpoint(tmp_path, monkeypatch, capsys):
    from census import cli

    monkeypatch.setattr(cli, "DATA", tmp_path)
    (tmp_path / "model" / "s" / "dataset").mkdir(parents=True)
    (tmp_path / "model" / "s" / "dataset" / "train.jsonl").write_text("")
    assert cli.main(["model", "train", "--snapshot", "s", "--name", "r", "--init", "base"]) == 1
    assert "no checkpoint" in capsys.readouterr().err
