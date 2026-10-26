"""A fine-tuned encoder that reads CRediT statements: the smallest model to compare with the rule parser.

One example per (article, author): the author's name, its initials and its place in the byline, then the
statement. The model answers 14 yes/no questions, one per CRediT role, so its output maps straight onto
the (position, slug) pairs `modelset.score` counts. Pair-level precision and recall pooled over examples
are the same numbers `census model score` prints.

The helpers that turn rows into examples and probabilities into pairs need no torch; training and
prediction import torch and transformers from the optional `train` dependency group.
"""

import hashlib
import json
import math
import random
import re
import subprocess
import sys
import time
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from census import labels
from census.modelset import Pairs, read_jsonl
from census.roles import ROLE_PATTERNS

ROLES = list(ROLE_PATTERNS)


@dataclass
class Config:
    """Every setting of a run, written to `<run>/config.json`."""

    model: str = "answerdotai/ModernBERT-base"
    revision: str = "8949b909ec900327062f0ebf497f51aef5e6f0c8"
    """The base model's commit on the Hugging Face Hub, so a rerun starts from the same weights."""
    train_articles: int = 120_000
    """Articles drawn from train.jsonl, by publisher and style (see `subsample`)."""
    dev_articles: int = 2_000
    dev_every: int = 50
    """One statement group in this many goes to dev, carved from train; held-out is never looked at."""
    max_length: int = 512
    batch_size: int = 32
    epochs: int = 1
    learning_rate: float = 3e-5
    weight_decay: float = 0.01
    warmup_share: float = 0.06
    seed: int = 20261018
    open_licence_only: bool = False
    """Train only on CC BY and CC0 articles (`publishable` in the dataset), so the weights can be shared."""
    device: str = "cuda"


THRESHOLDS = (0.3, 0.4, 0.5, 0.6, 0.7)
"""Decision thresholds tried on dev after each epoch; the best one is kept with the checkpoint."""


# --- rows to examples, and back ---


def initials(name: str) -> list[str]:
    """Ways a statement may write an author's initials: "N.-G.R.", "NGR" and "Ryu NG" for "Na-Gyeong Ryu".

    The last word is taken as the surname, which is right for most bylines; the model also sees the name.
    """
    words = name.split()
    if not words:
        return []
    *given, surname = words
    given_parts = [[p[0] for p in re.split(r"-+", g) if p] for g in given]
    dotted = "".join("-".join(f"{c}." for c in g) for g in given_parts) + f"{surname[0]}."
    compact = "".join(c for g in given_parts for c in g)
    variants = [dotted, compact + surname[0]] + ([f"{surname} {compact}"] if compact else [])
    return list(dict.fromkeys(variants))


def author_text(name: str, position: int, n_authors: int) -> str:
    return f"{name} ({', '.join(initials(name))}); author {position} of {n_authors}"


def label_vectors(gold: Iterable[Iterable[Any]], n_authors: int) -> list[list[float]]:
    """One 14-long 0/1 vector per author, in byline order, from gold [[position, slug], ...]."""
    vectors = [[0.0] * len(ROLES) for _ in range(n_authors)]
    for position, slug in gold:
        vectors[int(position) - 1][ROLES.index(slug)] = 1.0
    return vectors


def decode(probabilities: Iterable[Iterable[float]], threshold: float) -> Pairs:
    """(position, slug) for every author (in byline order) and role at or above the threshold."""
    return {
        (position, ROLES[r])
        for position, row in enumerate(probabilities, 1)
        for r, p in enumerate(row)
        if p >= threshold
    }


def stratum(row: dict[str, Any]) -> tuple[str, str]:
    return row["publisher"] or "", row["style"]


def is_dev(statement: str, every: int) -> bool:
    """Whether a training statement goes to dev. Identical statements (by `modelset`'s normalisation)
    land on the same side, so no copy of a dev text is trained on."""
    text = re.sub(r"\s+", " ", statement.strip()).lower()
    return int(hashlib.sha256(text.encode()).hexdigest(), 16) % every == 0


def subsample(rows: list[dict[str, Any]], target: int, seed: int) -> list[dict[str, Any]]:
    """About `target` rows (all of them if there are fewer), each publisher-and-style stratum getting a
    share in proportion to the square root of its size: MDPI and Frontiers still lead, the small
    publishers whose layouts differ get far more than their raw share. A stratum smaller than its share
    gives all its rows, and the rest of its share goes to the larger ones."""
    strata: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        strata[stratum(row)].append(row)
    weight = sum(math.sqrt(len(v)) for v in strata.values())
    rng = random.Random(seed)
    picked: list[dict[str, Any]] = []
    for key in sorted(strata, key=lambda k: (len(strata[k]), k)):  # smallest first, so leftovers flow up
        members = strata[key]
        share = math.ceil((target - len(picked)) * math.sqrt(len(members)) / weight)
        picked += rng.sample(members, max(0, min(len(members), share)))
        weight -= math.sqrt(len(members))
    rng.shuffle(picked)
    return picked


# --- training and prediction (torch) ---


class Encoded:
    """Token ids for each article's statement and each author, tokenised once; examples join them."""

    def __init__(self, tokenizer: Any, rows: list[dict[str, Any]], max_length: int):
        self.cls, self.sep, self.pad = tokenizer.cls_token_id, tokenizer.sep_token_id, tokenizer.pad_token_id
        self.max_length = max_length
        self.statements = tokenizer([r["statement"] for r in rows], add_special_tokens=False)["input_ids"]
        texts = [author_text(a, i, len(r["authors"])) for r in rows for i, a in enumerate(r["authors"], 1)]
        author_ids = iter(tokenizer(texts, add_special_tokens=False)["input_ids"]) if texts else iter(())
        self.examples: list[tuple[int, list[int]]] = []  # (row index, author ids)
        for k, row in enumerate(rows):
            self.examples += [(k, next(author_ids)) for _ in row["authors"]]
        self.truncated = {k for k, a in self.examples if len(a) + len(self.statements[k]) + 3 > max_length}

    def ids(self, example: int) -> list[int]:
        k, author = self.examples[example]
        author = author[: self.max_length // 4]  # a name this long is an error in the byline
        room = self.max_length - len(author) - 3
        return [self.cls, *author, self.sep, *self.statements[k][:room], self.sep]


def _batches(lengths: list[int], size: int, rng: random.Random | None) -> list[list[int]]:
    """Index batches of similar length, so little of each batch is padding. Shuffled when `rng` is given."""
    order = list(range(len(lengths)))
    if rng:
        rng.shuffle(order)
    pool = size * 50
    batches = []
    for start in range(0, len(order), pool):
        chunk = sorted(order[start : start + pool], key=lengths.__getitem__)
        batches += [chunk[i : i + size] for i in range(0, len(chunk), size)]
    if rng:
        rng.shuffle(batches)
    return batches


def _tensors(torch: Any, encoded: Encoded, batch: list[int], device: str) -> dict[str, Any]:
    ids = [encoded.ids(i) for i in batch]
    width = max(map(len, ids))
    input_ids = torch.tensor([x + [encoded.pad] * (width - len(x)) for x in ids], device=device)
    mask = torch.tensor([[1] * len(x) + [0] * (width - len(x)) for x in ids], device=device)
    return {"input_ids": input_ids, "attention_mask": mask}


def _probabilities(torch: Any, model: Any, encoded: Encoded, batch_size: int, device: str) -> list[list[float]]:
    """Per example, the probability of each role."""
    lengths = [len(encoded.ids(i)) for i in range(len(encoded.examples))]
    out: list[list[float]] = [[] for _ in lengths]
    model.eval()
    with (
        torch.inference_mode(),
        torch.autocast(device, dtype=torch.bfloat16, enabled=torch.device(device).type == "cuda"),
    ):
        for batch in _batches(lengths, batch_size * 4, None):
            probs = torch.sigmoid(model(**_tensors(torch, encoded, batch, device)).logits.float()).tolist()
            for i, p in zip(batch, probs, strict=True):
                out[i] = p
    return out


def _per_article(rows: list[dict[str, Any]], encoded: Encoded, probs: list[list[float]]) -> list[list[list[float]]]:
    grouped: list[list[list[float]]] = [[] for _ in rows]
    for (k, _), p in zip(encoded.examples, probs, strict=True):
        grouped[k].append(p)
    return grouped


def evaluate(rows: list[dict[str, Any]], per_article: list[list[list[float]]]) -> dict[str, dict[str, float]]:
    """Precision, recall, F1 and exact share on dev at each threshold, as `census model score` counts them."""
    gold = {r["pmcid"]: {(int(p), s) for p, s in r["gold"]} for r in rows}
    results = {}
    for t in THRESHOLDS:
        articles = (("(all)", decode(a, t), gold[r["pmcid"]], 1.0) for r, a in zip(rows, per_article, strict=True))
        ((_, _, precision, recall, f1, exact, _, _),) = labels.table(articles)
        results[str(t)] = {"precision": precision, "recall": recall, "f1": f1 or 0.0, "exact": exact}
    return results


def _log(log: Path, record: dict[str, Any]) -> None:
    print(json.dumps(record), flush=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def _git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent, capture_output=True, text=True)
    except OSError:  # no git on this machine
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def train(config: Config, dataset: Path, run: Path) -> dict[str, Any]:
    """Fine-tune on a subsample of `dataset/train.jsonl`, scoring dev after each epoch. Writes config.json,
    metrics.jsonl (a first line with the git commit, the data's hash, library versions and example counts,
    then one line per epoch, plus progress lines) and the best epoch's model to `run/checkpoint/` with its
    threshold in `run/best.json`. Returns best.json's content."""
    import torch
    import transformers
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

    torch.manual_seed(config.seed)
    run.mkdir(parents=True, exist_ok=True)
    (run / "config.json").write_text(json.dumps(asdict(config), indent=2) + "\n", encoding="utf-8")
    log = run / "metrics.jsonl"
    log.write_text("", encoding="utf-8")

    pool: dict[bool, list[dict[str, Any]]] = {True: [], False: []}
    for row in read_jsonl(dataset / "train.jsonl"):
        if row["authors"] and (not config.open_licence_only or row["publishable"]):
            pool[is_dev(row["statement"], config.dev_every)].append(row)
    train_rows = subsample(pool[False], config.train_articles, config.seed)
    dev_rows = random.Random(config.seed).sample(pool[True], min(config.dev_articles, len(pool[True])))

    with (dataset / "train.jsonl").open("rb") as f:
        train_sha256 = hashlib.file_digest(f, "sha256").hexdigest()
    tokenizer: Any = AutoTokenizer.from_pretrained(config.model, revision=config.revision)
    train_set = Encoded(tokenizer, train_rows, config.max_length)
    dev_set = Encoded(tokenizer, dev_rows, config.max_length)
    targets = [v for r in train_rows for v in label_vectors(r["gold"], len(r["authors"]))]
    _log(
        log,
        {
            "git_commit": _git_commit(),
            "train_jsonl_sha256": train_sha256,
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "train_articles": len(train_rows),
            "train_examples": len(train_set.examples),
            "dev_articles": len(dev_rows),
            "dev_examples": len(dev_set.examples),
            "train_truncated_articles": len(train_set.truncated),
            "dev_truncated_articles": len(dev_set.truncated),
        },
    )

    model = AutoModelForSequenceClassification.from_pretrained(
        config.model,
        revision=config.revision,
        num_labels=len(ROLES),
        id2label=dict(enumerate(ROLES)),
        label2id={role: i for i, role in enumerate(ROLES)},
        problem_type="multi_label_classification",
    ).to(config.device)
    lengths = [len(train_set.ids(i)) for i in range(len(train_set.examples))]
    rng = random.Random(config.seed)
    steps = config.epochs * math.ceil(len(lengths) / config.batch_size)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay)
    schedule = get_linear_schedule_with_warmup(optimizer, int(steps * config.warmup_share), steps)
    loss_fn = torch.nn.BCEWithLogitsLoss()
    use_bf16 = torch.device(config.device).type == "cuda"
    best: dict[str, Any] = {"f1": -1.0}
    start, step = time.monotonic(), 0
    for epoch in range(1, config.epochs + 1):
        model.train()
        for batch in _batches(lengths, config.batch_size, rng):
            inputs = _tensors(torch, train_set, batch, config.device)
            target = torch.tensor([targets[i] for i in batch], device=config.device)
            with torch.autocast(config.device, dtype=torch.bfloat16, enabled=use_bf16):
                logits = model(**inputs).logits
            loss = loss_fn(logits.float(), target)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            optimizer.zero_grad(set_to_none=True)
            step += 1
            if step % 200 == 0 or step == 1:
                seconds = time.monotonic() - start
                _log(log, {"step": step, "of": steps, "loss": round(loss.item(), 4), "seconds": round(seconds)})
        probs = _per_article(dev_rows, dev_set, _probabilities(torch, model, dev_set, config.batch_size, config.device))
        metrics = evaluate(dev_rows, probs)
        threshold, top = max(metrics.items(), key=lambda kv: kv[1]["f1"])
        record = {"epoch": epoch, "seconds": round(time.monotonic() - start), "dev": metrics}
        if use_bf16:
            record["max_gpu_memory_gb"] = round(torch.cuda.max_memory_allocated() / 1e9, 2)
        _log(log, record)
        if top["f1"] > best["f1"]:
            best = {"epoch": epoch, "threshold": float(threshold), **top}
            model.save_pretrained(run / "checkpoint")
            tokenizer.save_pretrained(run / "checkpoint")
            (run / "best.json").write_text(json.dumps(best, indent=2) + "\n", encoding="utf-8")
    return best


def _load(run: Path, device: str) -> tuple[Any, Any, float, int]:
    """The run's tokenizer, model, best threshold and max length."""
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    threshold = json.loads((run / "best.json").read_text(encoding="utf-8"))["threshold"]
    config = json.loads((run / "config.json").read_text(encoding="utf-8"))
    tokenizer = AutoTokenizer.from_pretrained(run / "checkpoint")
    model = AutoModelForSequenceClassification.from_pretrained(run / "checkpoint").to(device)
    return tokenizer, model, threshold, config["max_length"]


def predict(run: Path, items: Iterable[dict[str, Any]], out: Path, device: str, batch_size: int = 32) -> int:
    """Write one line {"pmcid", "pairs"} per item with the run's best checkpoint and threshold, in the format
    `run_zero_shot` writes. Returns the number of articles."""
    import torch

    tokenizer, model, threshold, max_length = _load(run, device)
    rows = list(items)
    encoded = Encoded(tokenizer, rows, max_length)
    if encoded.truncated:
        print(f"{len(encoded.truncated)} of {len(rows)} statements cut to {max_length} tokens", file=sys.stderr)
    probs = _per_article(rows, encoded, _probabilities(torch, model, encoded, batch_size, device))
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for row, p in zip(rows, probs, strict=True):
            f.write(json.dumps({"pmcid": row["pmcid"], "pairs": sorted(decode(p, threshold))}) + "\n")
    return len(rows)


def pair_rows(pmcids: list[str], pairs: list[Pairs]) -> dict[str, list[Any]]:
    """Columns pmcid, author_position, role: a row per pair, and one row with no position or role for an
    article given no role, so the file also says which articles were read."""
    columns: dict[str, list[Any]] = {"pmcid": [], "author_position": [], "role": []}
    for pmcid, found in zip(pmcids, pairs, strict=True):
        for position, role in sorted(found) or [(None, None)]:
            columns["pmcid"].append(pmcid)
            columns["author_position"].append(position)
            columns["role"].append(role)
    return columns


def predict_corpus(
    run: Path, chunks: Iterable[list[dict[str, Any]]], out: Path, device: str, total: int, batch_size: int = 32
) -> int:
    """Write `out/part-NNNNN.parquet` per chunk, with `pair_rows`' columns. A part already written is skipped,
    so a stopped run resumes when given the same chunks in the same order; a ValueError if a written part holds
    other articles than its chunk. Prints progress per part. Returns the number of articles read in this call."""
    import pyarrow as pa
    import pyarrow.parquet as pq
    import torch

    tokenizer, model, threshold, max_length = _load(run, device)
    out.mkdir(parents=True, exist_ok=True)
    schema = pa.schema([("pmcid", pa.string()), ("author_position", pa.int32()), ("role", pa.string())])
    start, done, seen = time.monotonic(), 0, 0
    for n, rows in enumerate(chunks):
        seen += len(rows)
        part = out / f"part-{n:05d}.parquet"
        if part.exists():
            # Another --chunk, or a database that changed, puts other articles under the same part number.
            if set(pq.read_table(part, columns=["pmcid"])["pmcid"].to_pylist()) != {r["pmcid"] for r in rows}:
                raise ValueError(
                    f"{part} holds other articles than chunk {n}; resume with the same --chunk and database"
                )
            continue
        encoded = Encoded(tokenizer, rows, max_length)
        probs = _per_article(rows, encoded, _probabilities(torch, model, encoded, batch_size, device))
        partial = part.with_suffix(".tmp")
        table = pa.table(pair_rows([r["pmcid"] for r in rows], [decode(p, threshold) for p in probs]), schema=schema)
        pq.write_table(table, partial)
        partial.rename(part)
        done += len(rows)
        rate = done / (time.monotonic() - start)
        left = (total - seen) / rate / 60
        print(
            f"{part.name}: {seen} of {total} articles ({len(encoded.truncated)} cut to {max_length} tokens),"
            f" {rate:.0f} articles/s, {left:.0f} min left",
            flush=True,
        )
    return done
