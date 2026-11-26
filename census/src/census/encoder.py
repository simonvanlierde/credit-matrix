"""A fine-tuned encoder that reads CRediT statements: the smallest model to compare with the rule parser.

The model answers 14 yes/no questions per author, one per CRediT role, so its output maps straight onto
the (position, slug) pairs `modelset.score` counts. Pair-level precision and recall pooled over articles
are the same numbers `census model score` prints. `census.onepass` builds the inputs and trains and
exports the model; this module holds the settings, the author text, the dev split, decoding to pairs,
scoring and the prediction writers.

None of it needs torch; `onepass` imports torch and transformers from the optional `train` dependency group.
"""

import hashlib
import json
import math
import random
import re
import sys
import time
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from census import labels
from census.modelset import Pairs
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


# --- rows to labels, and probabilities back to pairs ---


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


# --- batching, scoring and prediction ---


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


Reader = Callable[[list[dict[str, Any]]], tuple[list[list[list[float]]], int]]
"""Rows -> per article, per author, the role probabilities; and how many statements were cut."""


def predict(run: Path, items: Iterable[dict[str, Any]], out: Path, device: str, batch_size: int = 32) -> int:
    """Write one line {"pmcid", "pairs"} per item with the run's best checkpoint and threshold, in the format
    `run_zero_shot` writes. Returns the number of articles."""
    from census import onepass

    read, threshold, max_length = onepass.reader(run, device, batch_size)
    rows = list(items)
    probs, cut = read(rows)
    if cut:
        print(f"{cut} of {len(rows)} statements cut to {max_length} tokens", file=sys.stderr)
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

    from census import onepass

    read, threshold, max_length = onepass.reader(run, device, batch_size)
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
        probs, cut = read(rows)
        partial = part.with_suffix(".tmp")
        table = pa.table(pair_rows([r["pmcid"] for r in rows], [decode(p, threshold) for p in probs]), schema=schema)
        pq.write_table(table, partial)
        partial.rename(part)
        done += len(rows)
        rate = done / (time.monotonic() - start)
        left = (total - seen) / rate / 60
        print(
            f"{part.name}: {seen} of {total} articles ({cut} cut to {max_length} tokens),"
            f" {rate:.0f} articles/s, {left:.0f} min left",
            flush=True,
        )
    return done
