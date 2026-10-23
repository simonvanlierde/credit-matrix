import json

import pytest

from census import encoder, modelset


def test_initials_cover_dotted_compact_and_vancouver_forms():
    assert encoder.initials("Na-Gyeong Ryu") == ["N.-G.R.", "NGR", "Ryu NG"]
    assert encoder.initials("Ann Bo Smith") == ["A.B.S.", "ABS", "Smith AB"]
    assert encoder.initials("Plato") == ["P.", "P"]
    assert encoder.author_text("Bo Jones", 2, 3) == "Bo Jones (B.J., BJ, Jones B); author 2 of 3"


def test_label_vectors_round_trip_to_pairs():
    gold = [[1, "conceptualization"], [1, "writing-review-editing"], [3, "software"]]
    vectors = encoder.label_vectors(gold, 3)
    assert len(vectors) == 3 and all(len(v) == 14 for v in vectors)
    assert vectors[1] == [0.0] * 14
    assert encoder.decode(vectors, 0.5) == {(p, s) for p, s in gold}


def test_decode_keeps_roles_at_or_above_the_threshold():
    probs = [[0.0] * 14, [0.0] * 14]
    probs[0][encoder.ROLES.index("software")] = 0.5
    probs[1][encoder.ROLES.index("validation")] = 0.35
    assert encoder.decode(probs, 0.5) == {(1, "software")}
    assert encoder.decode(probs, 0.3) == {(1, "software"), (2, "validation")}
    assert encoder.decode([], 0.5) == set()


def test_dev_keeps_identical_statements_together():
    assert encoder.is_dev("AS:  Software.\nBJ: validation.", 7) == encoder.is_dev("as: software. bj: validation.", 7)
    assert 0 < sum(encoder.is_dev(f"statement {i}", 10) for i in range(1000)) < 200


def test_subsample_shares_by_square_root_of_stratum_size():
    rows = [{"publisher": "Big", "style": "jats4r", "i": i} for i in range(400)]
    rows += [{"publisher": "Small", "style": "plos_uri", "i": i} for i in range(25)]
    picked = encoder.subsample(rows, 100, seed=1)
    assert sum(r["publisher"] == "Big" for r in picked) == 80
    assert sum(r["publisher"] == "Small" for r in picked) == 20
    assert encoder.subsample(rows, 100, seed=1) == picked
    assert len(encoder.subsample(rows, 10_000, seed=1)) == 425  # capped at each stratum
    tiny = rows[:400] + [{"publisher": "Tiny", "style": "jats4r", "i": i} for i in range(4)]
    picked = encoder.subsample(tiny, 100, seed=1)
    assert len(picked) == 100 and sum(r["publisher"] == "Tiny" for r in picked) == 4  # its rest goes to Big


class WordTokenizer:
    """Stands in for a Hugging Face tokenizer: one id per word, the word's length."""

    cls_token_id, sep_token_id, pad_token_id = 1, 2, 0

    def __call__(self, texts, add_special_tokens=False):
        return {"input_ids": [[len(w) for w in t.split()] for t in texts]}


class CharTokenizer(WordTokenizer):
    """One id per character, so a long name runs past the author cap."""

    def __call__(self, texts, add_special_tokens=False):
        return {"input_ids": [[ord(c) for c in t] for t in texts]}


def test_examples_join_author_and_statement_and_cut_long_statements():
    rows = [
        {"statement": "aa bbb", "authors": ["Ann Smith", "Bo Jones"]},
        {"statement": " ".join("x" * (i % 7 + 1) for i in range(100)), "authors": ["Cy Li"]},
    ]
    encoded = encoder.Encoded(WordTokenizer(), rows, max_length=40)
    assert [k for k, _ in encoded.examples] == [0, 0, 1]
    ids = encoded.ids(0)
    # [CLS], ten words of "Ann Smith (A.S., AS, Smith A); author 1 of 2", [SEP], "aa bbb", [SEP]
    assert ids[0] == 1 and ids[-3:] == [2, 3, 2] and len(ids) == 15
    ids = encoded.ids(2)
    author = encoded.examples[2][1]
    assert len(ids) == 40 and ids[0] == 1 and ids[-1] == 2
    assert ids[1 : len(author) + 2] == [*author, 2]  # the author survives whole
    assert ids[len(author) + 2 : -1] == encoded.statements[1][: 40 - len(author) - 3]
    assert encoded.truncated == {1}


def test_a_runaway_author_name_is_cut_at_a_quarter_of_the_length():
    name = " ".join(f"Name{i:02d}" for i in range(40))
    rows = [{"statement": "s" * 600, "authors": [name]}]
    encoded = encoder.Encoded(CharTokenizer(), rows, max_length=512)
    ids = encoded.ids(0)
    assert len(encoded.examples[0][1]) > 128
    assert len(ids) == 512
    assert ids[1:130] == [*encoded.examples[0][1][:128], 2]
    assert ids[130:-1] == encoded.statements[0][: 512 - 128 - 3]


def test_evaluate_scores_dev_like_census_model_score():
    rows = [{"pmcid": "A", "gold": [[1, "software"]]}, {"pmcid": "B", "gold": [[1, "validation"]]}]
    sure = [[0.0] * 14]
    sure[0][encoder.ROLES.index("software")] = 0.9
    unsure = [[0.0] * 14]
    unsure[0][encoder.ROLES.index("validation")] = 0.45
    metrics = encoder.evaluate(rows, [sure, unsure])
    assert metrics["0.4"] == {"precision": 1.0, "recall": 1.0, "f1": 1.0, "exact": 1.0}
    assert metrics["0.5"]["recall"] == 0.5 and metrics["0.5"]["exact"] == 0.5


def tiny_model(path):
    """A one-layer ModernBERT with a word-level vocabulary, saved where `from_pretrained` finds it."""
    pytest.importorskip("torch")
    from tokenizers import Tokenizer, models, pre_tokenizers
    from transformers import ModernBertConfig, ModernBertModel, PreTrainedTokenizerFast

    words = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "software", "validation", "author", "of", "1", "2"]
    tok = Tokenizer(models.WordLevel({w: i for i, w in enumerate(words)}, unk_token="[UNK]"))
    tok.pre_tokenizer = pre_tokenizers.Whitespace()
    PreTrainedTokenizerFast(
        tokenizer_object=tok,
        pad_token="[PAD]",
        unk_token="[UNK]",
        cls_token="[CLS]",
        sep_token="[SEP]",
        mask_token="[MASK]",
    ).save_pretrained(path)
    config = ModernBertConfig(
        vocab_size=len(words),
        hidden_size=16,
        intermediate_size=32,
        num_hidden_layers=1,
        num_attention_heads=2,
        pad_token_id=0,
        cls_token_id=2,
        sep_token_id=3,
        bos_token_id=2,
        eos_token_id=3,
    )
    ModernBertModel(config).save_pretrained(path)


def test_train_and_predict_write_a_run_and_scorable_predictions(tmp_path):
    tiny_model(tmp_path / "tiny")
    dataset = tmp_path / "dataset"
    dataset.mkdir()
    rows = [
        {
            "pmcid": f"PMC{i}",
            "publisher": f"P{i % 2}",
            "style": "jats4r",
            "statement": f"{i} software validation",
            "authors": ["Ann Smith", "Bo Jones"],
            "gold": [[1, "software"], [2, "validation"]],
        }
        for i in range(40)
    ]
    (dataset / "train.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    config = encoder.Config(
        model=str(tmp_path / "tiny"), train_articles=30, dev_every=4, epochs=2, batch_size=8, device="cpu"
    )
    run = tmp_path / "run"
    best = encoder.train(config, dataset, run)
    assert best["epoch"] in (1, 2) and str(best["threshold"]) in map(str, encoder.THRESHOLDS)
    epochs = [json.loads(line) for line in (run / "metrics.jsonl").read_text().splitlines()]
    assert [e["epoch"] for e in epochs if "epoch" in e] == [1, 2]
    assert json.loads((run / "config.json").read_text())["seed"] == config.seed
    assert json.loads((run / "checkpoint" / "config.json").read_text())["id2label"]["13"] == encoder.ROLES[13]

    out = tmp_path / "preds.jsonl"
    items = [*rows[:3], {"pmcid": "PMC99", "statement": "x", "authors": []}]
    assert encoder.predict(run, items, out, "cpu") == 4
    predicted = modelset.read_predictions(out)
    assert set(predicted) == {"PMC0", "PMC1", "PMC2", "PMC99"} and predicted["PMC99"] == set()
    assert all(p in {1, 2} for pairs in predicted.values() for p, _ in pairs)


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
    config = encoder.Config(
        model=str(tmp_path / "tiny"), train_articles=100, dev_every=4, epochs=1, device="cpu", open_licence_only=True
    )
    encoder.train(config, dataset, tmp_path / "run")
    first = json.loads((tmp_path / "run" / "metrics.jsonl").read_text().splitlines()[0])
    assert first["train_articles"] + first["dev_articles"] == 30


def test_pair_rows_keep_articles_given_no_role():
    columns = encoder.pair_rows(["A", "B"], [{(2, "software"), (1, "validation")}, set()])
    assert columns == {
        "pmcid": ["A", "A", "B"],
        "author_position": [1, 2, None],
        "role": ["validation", "software", None],
    }


def tiny_run(run, threshold=0.0):
    """An untrained run of `tiny_model` with a classification head, as `train` leaves one."""
    tiny_model(run / "checkpoint")
    from transformers import AutoModelForSequenceClassification

    model = AutoModelForSequenceClassification.from_pretrained(run / "checkpoint", num_labels=14)
    model.save_pretrained(run / "checkpoint")
    (run / "best.json").write_text(json.dumps({"threshold": threshold}))
    (run / "config.json").write_text('{"max_length": 32}')


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


def test_browser_build_matches_torch(tmp_path):
    pytest.importorskip("onnxruntime")
    from census import browser

    run, out = tmp_path / "run", tmp_path / "browser"
    tiny_run(run, threshold=0.5)
    sizes = browser.export(run, out)
    assert set(sizes) == set(browser.VARIANTS) and all(sizes.values())
    rows = [
        {"pmcid": f"PMC{i}", "statement": "1 software 2 validation", "authors": ["Ann Smith", "Bo Jones"][: i % 2 + 1]}
        for i in range(6)
    ]
    rows = [{**r, "gold": [[1, "software"]]} for r in rows]
    import onnxruntime as ort
    import torch

    tokenizer, model, _, max_length = encoder._load(run, "cpu")
    encoded = encoder.Encoded(tokenizer, rows, max_length)
    expected = encoder._probabilities(torch, model, encoded, 4, "cpu")
    session = ort.InferenceSession(str(out / "onnx" / "model.onnx"), providers=["CPUExecutionProvider"])
    got = browser._onnx_probabilities(session, encoded, 4)
    assert [p for e in got for p in e] == pytest.approx([p for e in expected for p in e], abs=1e-4)
    results = browser.evaluate(out, rows, threads=1)
    assert results["fp32"]["same_as_fp32"] == 1.0 and results["fp32"]["articles"] == 6


def test_cli_train_refuses_a_run_with_a_checkpoint(tmp_path, monkeypatch, capsys):
    from census import cli

    monkeypatch.setattr(cli, "DATA", tmp_path)
    (tmp_path / "model" / "s" / "runs" / "r" / "checkpoint").mkdir(parents=True)
    assert cli.main(["model", "train", "--snapshot", "s", "--name", "r"]) == 1
    assert "pick a new --name" in capsys.readouterr().err
    assert cli.main(["model", "predict", "--snapshot", "s", "--name", "other"]) == 1


def test_cli_model_refuses_options_it_would_ignore_or_trip_on(tmp_path, monkeypatch, capsys):
    from census import cli

    monkeypatch.setattr(cli, "DATA", tmp_path)
    (tmp_path / "model" / "s" / "dataset").mkdir(parents=True)
    (tmp_path / "model" / "s" / "dataset" / "train.jsonl").write_text("")
    assert cli.main(["model", "train", "--snapshot", "s", "--name", "r", "--model", "other/model"]) == 1
    assert "--model needs --revision" in capsys.readouterr().err
    (tmp_path / "model" / "s" / "runs" / "r").mkdir(parents=True)
    (tmp_path / "model" / "s" / "runs" / "r" / "best.json").write_text("{}")
    assert cli.main(["model", "predict", "--snapshot", "s", "--name", "r", "--limit", "5"]) == 1
    assert "go with --corpus" in capsys.readouterr().err
