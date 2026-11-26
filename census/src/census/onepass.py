"""The encoder read once per statement for all its authors, instead of once per author.

One input per article: `[CLS] <m> author 1 <m> author 2 ... [SEP] statement [SEP]`, with a marker token
`<m>` before each author's `encoder.author_text`. The classification head of `encoder` reads the hidden
state at each marker, so the model gives 14 role logits per author. A byline too long to fit `max_length`
with the statement is split into chunks of authors that each repeat the statement; each author keeps its
"author i of n" text, so a chunk still knows where its authors sit.

The checkpoint has the same layout as `encoder`'s (a `ModernBertForSequenceClassification`); only the
inputs differ, so `run/config.json` names the marker token. Input building and decoding need no torch.
"""

import hashlib
import json
import random
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from census import encoder, runinfo
from census.modelset import read_jsonl

MARKER = "[unused0]"
"""An unused token of the Ettin/ModernBERT vocabulary, so the embedding matrix keeps its size."""


@dataclass
class Config(encoder.Config):
    init: str = ""
    """A run's checkpoint to start from (its encoder and head), or empty to start from `model`."""
    marker: str = MARKER


@dataclass
class Chunk:
    row: int
    authors: list[int]
    """Byline indexes (from 0) of the authors this chunk reads, in order."""
    ids: list[int]
    markers: list[int]
    """Position of each author's marker in `ids`."""


def statement_room(authors: list[list[int]], max_length: int) -> int:
    """How many statement tokens a chunk keeps: all that fit beside the whole byline, but at least
    `max_length` less a quarter for authors (or the longest author, if longer), so a statement near
    `max_length` still reads many authors per chunk instead of one."""
    lengths = [1 + len(a[: max_length // 4]) for a in authors]
    return max_length - 3 - min(sum(lengths), max(max(lengths), max_length // 4))


def chunks(
    authors: list[list[int]], statement: list[int], max_length: int, cls: int, sep: int, marker: int, row: int = 0
) -> list[Chunk]:
    """The inputs for one article: as many authors per chunk as fit with the statement. An author's ids are
    cut at a quarter of `max_length`, as `encoder.Encoded` does, and the statement to `statement_room`, so
    every chunk holds at least one author. No authors, no chunks."""
    if not authors:
        return []
    statement = statement[: statement_room(authors, max_length)]
    authors = [a[: max_length // 4] for a in authors]
    room = max_length - 3 - len(statement)
    groups: list[list[int]] = [[]]
    used = 0
    for i, a in enumerate(authors):
        if groups[-1] and used + 1 + len(a) > room:
            groups.append([])
            used = 0
        groups[-1].append(i)
        used += 1 + len(a)
    out = []
    for group in groups:
        ids, markers = [cls], []
        for i in group:
            markers.append(len(ids))
            ids += [marker, *authors[i]]
        out.append(Chunk(row, group, [*ids, sep, *statement, sep], markers))
    return out


def per_article(n_authors: list[int], items: list[Chunk], probs: list[list[list[float]]]) -> list[list[list[float]]]:
    """Each article's per-author probabilities in byline order, from each chunk's per-marker rows."""
    out: list[list[list[float]]] = [[[] for _ in range(n)] for n in n_authors]
    for chunk, rows in zip(items, probs, strict=True):
        for i, p in zip(chunk.authors, rows, strict=True):
            out[chunk.row][i] = p
    return out


class Encoded:
    """Every article's chunks, tokenised once."""

    def __init__(self, tokenizer: Any, rows: list[dict[str, Any]], max_length: int, marker: str = MARKER):
        marker_id = tokenizer.convert_tokens_to_ids(marker)
        if marker_id == tokenizer.unk_token_id:
            raise ValueError(f"{marker} is not in the tokenizer's vocabulary")
        self.pad = tokenizer.pad_token_id
        statements = tokenizer([r["statement"] for r in rows], add_special_tokens=False)["input_ids"]
        texts = [encoder.author_text(a, i, len(r["authors"])) for r in rows for i, a in enumerate(r["authors"], 1)]
        author_ids = iter(tokenizer(texts, add_special_tokens=False)["input_ids"]) if texts else iter(())
        self.n_authors = [len(r["authors"]) for r in rows]
        self.chunks: list[Chunk] = []
        self.truncated: set[int] = set()
        for k, (row, statement) in enumerate(zip(rows, statements, strict=True)):
            authors: list[list[int]] = [next(author_ids) for _ in row["authors"]]
            made = chunks(authors, statement, max_length, tokenizer.cls_token_id, tokenizer.sep_token_id, marker_id, k)
            if authors and len(statement) > statement_room(authors, max_length):
                self.truncated.add(k)
            self.chunks += made
        self.split = {c.row for c in self.chunks if len(c.authors) < self.n_authors[c.row]}


# --- training, prediction and export (torch) ---


def _model(torch: Any, seq: Any) -> Any:
    """`seq` (a sequence classifier) applied at the marker positions: logits [batch, markers, 14]."""

    class OnePass(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.seq = seq

        def forward(self, input_ids: Any, attention_mask: Any, marker_positions: Any) -> Any:
            hidden = self.seq.model(input_ids=input_ids, attention_mask=attention_mask)[0]
            index = marker_positions.unsqueeze(-1).expand(-1, -1, hidden.shape[-1])
            return self.seq.classifier(self.seq.drop(self.seq.head(hidden.gather(1, index))))

    return OnePass()


def _tensors(torch: Any, encoded: Encoded, batch: list[int], device: str) -> dict[str, Any]:
    """input_ids and attention_mask padded to the batch's longest chunk, marker_positions to its most
    authors (padded with 0, the [CLS] position, whose rows are ignored), and marker_mask saying which are real."""
    items = [encoded.chunks[i] for i in batch]
    width, most = max(len(c.ids) for c in items), max(len(c.markers) for c in items)
    return {
        "input_ids": torch.tensor([c.ids + [encoded.pad] * (width - len(c.ids)) for c in items], device=device),
        "attention_mask": torch.tensor([[1] * len(c.ids) + [0] * (width - len(c.ids)) for c in items], device=device),
        "marker_positions": torch.tensor([c.markers + [0] * (most - len(c.markers)) for c in items], device=device),
        "marker_mask": torch.tensor([[True] * len(c.markers) + [False] * (most - len(c.markers)) for c in items]),
    }


def _probabilities(torch: Any, model: Any, encoded: Encoded, batch_size: int, device: str) -> list[list[list[float]]]:
    """Per article, per author, the probability of each role."""
    lengths = [len(c.ids) for c in encoded.chunks]
    out: list[list[list[float]]] = [[] for _ in lengths]
    model.eval()
    with (
        torch.inference_mode(),
        torch.autocast(device, dtype=torch.bfloat16, enabled=torch.device(device).type == "cuda"),
    ):
        for batch in encoder._batches(lengths, batch_size, None):
            inputs = _tensors(torch, encoded, batch, device)
            mask = inputs.pop("marker_mask")
            probs = torch.sigmoid(model(**inputs).float()).tolist()
            for i, p, m in zip(batch, probs, mask.tolist(), strict=True):
                out[i] = [row for row, real in zip(p, m, strict=True) if real]
    return per_article(encoded.n_authors, encoded.chunks, out)


def _load_seq(path: str | Path, revision: str | None = None) -> Any:
    from transformers import AutoModelForSequenceClassification

    return AutoModelForSequenceClassification.from_pretrained(
        path,
        revision=revision,
        num_labels=len(encoder.ROLES),
        id2label=dict(enumerate(encoder.ROLES)),
        label2id={role: i for i, role in enumerate(encoder.ROLES)},
        problem_type="multi_label_classification",
    )


def train(config: Config, dataset: Path, run: Path) -> dict[str, Any]:
    """As `encoder.train`, with one example per chunk and the loss over each chunk's authors. With
    `config.init`, the encoder and head start from that checkpoint, and its tokenizer is used."""
    import torch
    import transformers
    from transformers import AutoTokenizer, get_linear_schedule_with_warmup

    torch.manual_seed(config.seed)
    run.mkdir(parents=True, exist_ok=True)
    (run / "config.json").write_text(json.dumps(asdict(config), indent=2) + "\n", encoding="utf-8")
    log = run / "metrics.jsonl"
    log.write_text("", encoding="utf-8")

    pool: dict[bool, list[dict[str, Any]]] = {True: [], False: []}
    for row in read_jsonl(dataset / "train.jsonl"):
        if row["authors"] and (not config.open_licence_only or row["publishable"]):
            pool[encoder.is_dev(row["statement"], config.dev_every)].append(row)
    train_rows = encoder.subsample(pool[False], config.train_articles, config.seed)
    dev_rows = random.Random(config.seed).sample(pool[True], min(config.dev_articles, len(pool[True])))
    with (dataset / "train.jsonl").open("rb") as f:
        train_sha256 = hashlib.file_digest(f, "sha256").hexdigest()

    source = (config.init, None) if config.init else (config.model, config.revision)
    tokenizer: Any = AutoTokenizer.from_pretrained(source[0], revision=source[1])
    train_set = Encoded(tokenizer, train_rows, config.max_length, config.marker)
    dev_set = Encoded(tokenizer, dev_rows, config.max_length, config.marker)
    vectors = [encoder.label_vectors(r["gold"], len(r["authors"])) for r in train_rows]
    targets = [[vectors[c.row][i] for i in c.authors] for c in train_set.chunks]
    _log = encoder._log
    _log(
        log,
        {
            "git_commit": runinfo.git_commit(),
            "train_jsonl_sha256": train_sha256,
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "train_articles": len(train_rows),
            "train_chunks": len(train_set.chunks),
            "train_split_articles": len(train_set.split),
            "dev_articles": len(dev_rows),
            "dev_chunks": len(dev_set.chunks),
            "train_truncated_articles": len(train_set.truncated),
            "dev_truncated_articles": len(dev_set.truncated),
        },
    )

    seq = _load_seq(*source)
    model = _model(torch, seq).to(config.device)
    lengths = [len(c.ids) for c in train_set.chunks]
    rng = random.Random(config.seed)
    steps = config.epochs * -(-len(lengths) // config.batch_size)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay)
    schedule = get_linear_schedule_with_warmup(optimizer, int(steps * config.warmup_share), steps)
    loss_fn = torch.nn.BCEWithLogitsLoss()
    use_bf16 = torch.device(config.device).type == "cuda"
    best: dict[str, Any] = {"f1": -1.0}
    start, step = time.monotonic(), 0
    for epoch in range(1, config.epochs + 1):
        model.train()
        for batch in encoder._batches(lengths, config.batch_size, rng):
            inputs = _tensors(torch, train_set, batch, config.device)
            mask = inputs.pop("marker_mask").to(config.device)
            target = torch.tensor([t for i in batch for t in targets[i]], device=config.device)
            with torch.autocast(config.device, dtype=torch.bfloat16, enabled=use_bf16):
                logits = model(**inputs)
            loss = loss_fn(logits.float()[mask], target)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            optimizer.zero_grad(set_to_none=True)
            step += 1
            if step % 200 == 0 or step == 1:
                seconds = time.monotonic() - start
                _log(log, {"step": step, "of": steps, "loss": round(loss.item(), 4), "seconds": round(seconds)})
        probs = _probabilities(torch, model, dev_set, config.batch_size, config.device)
        metrics = encoder.evaluate(dev_rows, probs)
        threshold, top = max(metrics.items(), key=lambda kv: kv[1]["f1"])
        record = {"epoch": epoch, "seconds": round(time.monotonic() - start), "dev": metrics}
        if use_bf16:
            record["max_gpu_memory_gb"] = round(torch.cuda.max_memory_allocated() / 1e9, 2)
        _log(log, record)
        if top["f1"] > best["f1"]:
            best = {"epoch": epoch, "threshold": float(threshold), **top}
            seq.save_pretrained(run / "checkpoint")
            tokenizer.save_pretrained(run / "checkpoint")
            (run / "best.json").write_text(json.dumps(best, indent=2) + "\n", encoding="utf-8")
    return best


def reader(run: Path, device: str, batch_size: int = 32) -> tuple[encoder.Reader, float, int]:
    """As `encoder.reader`, for a one-pass run."""
    import torch
    from transformers import AutoTokenizer

    config = json.loads((run / "config.json").read_text(encoding="utf-8"))
    threshold = json.loads((run / "best.json").read_text(encoding="utf-8"))["threshold"]
    tokenizer = AutoTokenizer.from_pretrained(run / "checkpoint")
    model = _model(torch, _load_seq(run / "checkpoint")).to(device)

    def read(rows: list[dict[str, Any]]) -> tuple[list[list[list[float]]], int]:
        encoded = Encoded(tokenizer, rows, config["max_length"], config["marker"])
        return _probabilities(torch, model, encoded, batch_size, device), len(encoded.truncated)

    return read, threshold, config["max_length"]


def probabilities(run: Path, rows: list[dict[str, Any]], device: str, batch_size: int = 32) -> list[list[list[float]]]:
    """Per article, per author, the role probabilities of the run's best checkpoint."""
    return reader(run, device, batch_size)[0](rows)[0]


VARIANTS = {"fp32": "model.onnx", "int8": "model_int8.onnx", "w8": "model_w8.onnx"}
"""int8 quantises activations per call, which costs this graph more pairs than the per-author one (one call
reads every author). w8 keeps activations in fp32: 8-bit weights in blocks of 32 (MatMulNBits, which
onnxruntime-web runs) and an int8 embedding table, at about the size of int8."""


def export(run: Path, out: Path) -> dict[str, int]:
    """The run's best checkpoint as ONNX in each of `VARIANTS`, with inputs input_ids,
    attention_mask [batch, length] and marker_positions [batch, authors] (int64), and output logits
    [batch, authors, 14]. Beside them the tokenizer, best.json (threshold) and run.json (max length, marker)."""
    import onnx
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer
    from transformers import AutoModelForSequenceClassification

    weights = out / "onnx"
    weights.mkdir(parents=True, exist_ok=True)
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json"):
        shutil.copy(run / "checkpoint" / name, out / name)
    shutil.copy(run / "best.json", out / "best.json")
    config = json.loads((run / "config.json").read_text(encoding="utf-8"))
    if config["init"]:  # the run it started from, by name: a local path means nothing on the Hub
        config["init"] = Path(config["init"]).parent.name
    (out / "run.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    seq = AutoModelForSequenceClassification.from_pretrained(run / "checkpoint", attn_implementation="eager")
    model = _model(torch, seq).eval()
    ids = torch.ones((2, 16), dtype=torch.long)
    batch, length, authors = (
        torch.export.Dim("batch"),
        torch.export.Dim("length", max=8192),
        torch.export.Dim("authors"),
    )
    torch.onnx.export(
        model,
        (),
        weights / VARIANTS["fp32"],
        kwargs={
            "input_ids": ids,
            "attention_mask": torch.ones_like(ids),
            "marker_positions": torch.tensor([[1, 5, 9], [1, 5, 9]]),
        },
        input_names=["input_ids", "attention_mask", "marker_positions"],
        output_names=["logits"],
        dynamic_shapes={
            "input_ids": {0: batch, 1: length},
            "attention_mask": {0: batch, 1: length},
            "marker_positions": {0: batch, 1: authors},
        },
        external_data=False,
        dynamo=True,
    )
    graph = onnx.load(weights / VARIANTS["fp32"])
    del graph.graph.value_info[:]  # see browser.export
    onnx.save(graph, weights / VARIANTS["fp32"])
    quantize_dynamic(weights / VARIANTS["fp32"], weights / VARIANTS["int8"], weight_type=QuantType.QInt8)
    blocks = MatMulNBitsQuantizer(
        onnx.load(weights / VARIANTS["fp32"]),
        algo_config=DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=8),
    )
    blocks.process()
    partial = weights / "model_w8_matmul.onnx"
    quantised: Any = blocks.model  # an ONNXModel once processed, as in browser.export
    quantised.save_model_to_file(str(partial))
    # The quantizer packs Gather in 4 bits only; quantize_dynamic stores the embedding table in int8.
    quantize_dynamic(partial, weights / VARIANTS["w8"], weight_type=QuantType.QInt8, op_types_to_quantize=["Gather"])
    partial.unlink()
    return {name: (weights / file).stat().st_size for name, file in VARIANTS.items()}


def onnx_probabilities(session: Any, encoded: Encoded, batch_size: int) -> list[list[list[float]]]:
    """As `_probabilities`, with an onnxruntime session of `export`'s graph."""
    import numpy as np
    import torch

    lengths = [len(c.ids) for c in encoded.chunks]
    out: list[list[list[float]]] = [[] for _ in lengths]
    for batch in encoder._batches(lengths, batch_size, None):
        inputs = {k: v.numpy() for k, v in _tensors(torch, encoded, batch, "cpu").items()}
        mask = inputs.pop("marker_mask")
        (logits,) = session.run(["logits"], inputs)
        for i, p, m in zip(batch, 1 / (1 + np.exp(-logits)), mask, strict=True):
            out[i] = p[m].tolist()
    return per_article(encoded.n_authors, encoded.chunks, out)


_CAST = [
    "Marie Curie", "Ada Lovelace", "Charles Darwin", "Rosalind Franklin", "Alan Turing", "Hua Luogeng",
    "Antonie van Leeuwenhoek", "Grace Hopper", "Emmy Noether", "Niels Bohr", "Lise Meitner", "Max Planck",
    "Dorothy Hodgkin", "Barbara McClintock", "Gregor Mendel", "Louis Pasteur", "Alexander Fleming",
    "Srinivasa Ramanujan", "Chien-Shiung Wu", "Carl Linnaeus", "Katherine Johnson", "Tu Youyou",
    "Mary Anning", "Jagadish Chandra Bose", "Hedy Lamarr",
]  # fmt: skip
_PROSE = (
    "M.C. and A.L. conceived the study and designed the experiments. C.D., R.F. and A.T. carried out the field"
    " work, and H.L. and A.v.L. collected the samples. G.H. wrote the analysis software and E.N. maintained the"
    " database. N.B. and L.M. analysed the data and made the figures. M.P. and D.H. checked the results. B.M."
    " managed the project and G.M. supervised the lab work. L.P. and A.F. provided the reagents and equipment."
    " S.R. obtained the funding. C.-S.W. and C.L. wrote the first draft, and all authors revised the manuscript."
)
PARITY_CASES = [
    {
        "case": "short CRediT",
        "authors": _CAST[:4],
        "statement": "Conceptualization, M.C. and A.L.; software, C.D.; investigation, R.F.; writing - original"
        " draft, M.C.; writing - review and editing, all authors.",
    },
    {
        "case": "prose",
        "authors": _CAST[:5],
        "statement": "Marie Curie and Ada Lovelace designed the study. Charles Darwin ran the field trials and"
        " Rosalind Franklin built the imaging pipeline. Alan Turing analysed the data and drafted the paper.",
    },
    {"case": "longer than max_length, chunked", "authors": _CAST[:20], "statement": " ".join([_PROSE] * 7)},
    {
        "case": "25 authors, split across chunks",
        "authors": _CAST,
        "statement": " ".join([_PROSE] * 3) + " K.J., T.Y., M.A., J.C.B. and H.L. validated the methods.",
    },
    {
        "case": "non-ASCII letters and hyphens",
        "authors": ["Marie Skłodowska-Curie", "Paul Erdős", "Émilie du Châtelet", "Jean-Baptiste Lamarck", "Øle Rømer"],
        "statement": "M.S.-C. and P.E. conceived the work; É.d.C. performed the measurements; J.-B.L. curated"
        " the data; Ø.R. supervised. All authors approved the final version.",
    },
    {
        "case": "CRediT by full name",
        "authors": _CAST[:3],
        "statement": "Marie Curie: Conceptualization, Funding acquisition. Ada Lovelace: Software, Formal"
        " analysis, Visualization. Charles Darwin: Investigation, Writing - review & editing.",
    },
    {
        # í is the bytes C3 AD and the soft hyphen C2 AD: 0xAD is one of the bytes GPT-2's alphabet remaps.
        "case": "the 0xAD byte, contractions, tabs, newlines, runs of spaces and an emoji",
        "authors": ["Ana Rodríguez", "Íñigo Núñez", "María Ibáñez"],
        "statement": "A.R. and Í.N. didn't, but we'll say they'd I'M sure it's done; they're, we've.\n\n M.I.  wrote"
        "\t the 1ª draft «in full» of the co\u00adauthored text \U0001f9ea.\nmulti\n\nline  a  b   c   ",
    },
    {
        "case": "a word longer than any token",
        "authors": _CAST[:2],
        "statement": "M.C. deposited the sequence " + "ACGTTGCA" * 80 + " and A.L. checked it.",
    },
]
"""Statements whose inputs and outputs the app's worker must reproduce; the cast is fictional use of
well-known names, so the file can be shared."""


def parity(out: Path, variant: str = "w8") -> list[dict[str, Any]]:
    """For each of `PARITY_CASES`, with the export in `out`: the author_text strings and, per chunk (one
    onnxruntime call each), input_ids, attention_mask, marker_positions, the logits and their sigmoid,
    and the pairs at the export's threshold. The browser's worker must give the same."""
    import numpy as np
    import onnxruntime as ort
    from transformers import AutoTokenizer

    config = json.loads((out / "run.json").read_text(encoding="utf-8"))
    threshold = json.loads((out / "best.json").read_text(encoding="utf-8"))["threshold"]
    tokenizer = AutoTokenizer.from_pretrained(out)
    session = ort.InferenceSession(str(out / "onnx" / VARIANTS[variant]), providers=["CPUExecutionProvider"])
    results = []
    for case in PARITY_CASES:
        encoded = Encoded(tokenizer, [case], config["max_length"], config["marker"])
        n = len(case["authors"])
        chunks_out, probs = [], [[] for _ in range(n)]
        for c in encoded.chunks:
            feeds = {
                "input_ids": np.array([c.ids]),
                "attention_mask": np.ones((1, len(c.ids)), dtype=np.int64),
                "marker_positions": np.array([c.markers]),
            }
            logits = np.asarray(session.run(["logits"], feeds)[0])[0]
            p = 1 / (1 + np.exp(-logits))
            for i, row in zip(c.authors, p.tolist(), strict=True):
                probs[i] = row
            chunks_out.append(
                {
                    "authors": [i + 1 for i in c.authors],
                    "input_ids": c.ids,
                    "attention_mask": [1] * len(c.ids),
                    "marker_positions": c.markers,
                    "logits": logits.tolist(),
                    "probabilities": p.tolist(),
                }
            )
        results.append(
            {
                **case,
                "author_text": [encoder.author_text(a, i, n) for i, a in enumerate(case["authors"], 1)],
                "statement_cut": bool(encoded.truncated),
                "chunks": chunks_out,
                "pairs": sorted(encoder.decode(probs, threshold)),
            }
        )
    meta = {"file": f"onnx/{VARIANTS[variant]}", "threshold": threshold, "roles": encoder.ROLES}
    meta |= {k: config[k] for k in ("max_length", "marker")}
    (out / "parity.json").write_text(json.dumps({"model": meta, "cases": results}, indent=1) + "\n", encoding="utf-8")
    return results
