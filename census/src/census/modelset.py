"""Training and evaluation sets for a statement-parsing model, and the baselines it has to beat.

Training pairs are free: an article whose roles are tagged (`jats4r`, `plos_uri`) and that also prints
a statement gives the statement as input and the tags as gold. `split` pins which of those articles
are held out; `dataset` writes both sides as JSONL; `score` measures any predictions against the
held-out tags with `labels.table`, the counting `labels.score` uses for a hand-labelled CSV.
"""

import csv
import hashlib
import json
import sys
import urllib.request
from collections import defaultdict
from collections.abc import Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa

from census import labels
from census.export import OPEN_LICENCE
from census.roles import ROLE_PATTERNS

TAGGED_STYLES = ("jats4r", "plos_uri")
HELD_OUT_SHARE = 0.05
SPLIT_SEED = "credit-census-model-v1"
"""Changing either draws a different split: write it to a new manifest, never over a pinned one."""

type Pairs = set[tuple[int, str]]
"""(author position from 1, role slug)."""

# Identical statements share a group and so a split, whatever their whitespace or case: a journal that
# prints one text on many articles must not have copies on both sides.
_POOL = f"""
SELECT pmcid, coalesce(publisher, '') AS publisher, coalesce(year, 0) AS year, style,
       sha256(lower(regexp_replace(trim(statement), '\\s+', ' ', 'g'))) AS text_hash
FROM articles
WHERE style IN {TAGGED_STYLES} AND statement IS NOT NULL AND n_authors > 0
"""


def draw_split(con: duckdb.DuckDBPyConnection, share: float = HELD_OUT_SHARE, seed: str = SPLIT_SEED) -> list[tuple]:
    """(pmcid, split, publisher, year, style, group) for every tagged article with a statement.

    Whole groups of identical statements go to one side. Groups are ordered by the publisher and year of
    their first article, then by a seeded hash, and every 1/share-th is held out: each publisher and
    year gets its share, small strata included, and the draw does not depend on row order.
    """
    groups: dict[str, list[tuple]] = defaultdict(list)
    for row in con.execute(_POOL).fetchall():
        groups[row[4]].append(row)
    order = sorted(
        groups,
        key=lambda g: (*min(groups[g])[1:3], hashlib.sha256(f"{seed}:{g}".encode()).hexdigest()),
    )
    rows = []
    for i, group in enumerate(order):
        split = "held_out" if int((i + 1) * share) > int(i * share) else "train"
        rows += [
            (pmcid, split, publisher, year, style, group[:16]) for pmcid, publisher, year, style, _ in groups[group]
        ]
    return sorted(rows)


_HEADER = ["pmcid", "split", "publisher", "year", "style", "group"]


def write_split(rows: list[tuple], path: Path) -> str:
    """Write the manifest once: a pinned split is never redrawn. Returns its sha256, for the README."""
    if path.exists():
        raise FileExistsError(f"{path} exists; a pinned split is never redrawn")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(_HEADER)
        writer.writerows(rows)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_split(path: Path) -> dict[str, str]:
    """pmcid -> split."""
    with path.open(newline="", encoding="utf-8") as f:
        return {r["pmcid"]: r["split"] for r in csv.DictReader(f)}


def write_dataset(con: duckdb.DuckDBPyConnection, split: dict[str, str], out: Path) -> dict[str, int]:
    """`<split>.jsonl` per split: statement, authors in byline order (position = index + 1), gold pairs
    from the tags, licence. Only rows with `publishable` true (CC BY or CC0) may ever be shared; the
    rest are for local training. The files name authors, so they stay in data/."""
    con.register("_split", pa.table({"pmcid": list(split), "split": list(split.values())}))
    cursor = con.execute(f"""
        WITH gold AS (
            SELECT pmcid, list(struct_pack(p := author_position, r := role) ORDER BY author_position, role) AS gold
            FROM assignments WHERE pmcid IN (SELECT pmcid FROM _split) GROUP BY pmcid
        )
        SELECT s.split, a.pmcid, a.publisher, a.year, a.style, a.license,
               regexp_matches(coalesce(a.license, ''), '{OPEN_LICENCE}') AS publishable, a.statement, a.authors,
               coalesce(g.gold, []) AS gold
        FROM _split s JOIN articles a USING (pmcid) LEFT JOIN gold g USING (pmcid)
        ORDER BY s.split, a.pmcid""")
    columns = [d[0] for d in cursor.description or ()]
    out.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = defaultdict(int)
    files: dict[str, Any] = {}
    try:
        while batch := cursor.fetchmany(10_000):
            for values in batch:
                row = dict(zip(columns, values, strict=True))
                row["gold"] = [[g["p"], g["r"]] for g in row["gold"]]
                name = row.pop("split")
                if name not in files:
                    files[name] = (out / f"{name}.jsonl").open("w", encoding="utf-8")
                files[name].write(json.dumps({"pmcid": row.pop("pmcid"), **row}, ensure_ascii=False) + "\n")
                counts[name] += 1
    finally:
        for f in files.values():
            f.close()
        con.unregister("_split")
    return dict(counts)


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open(encoding="utf-8") as f:
        yield from (json.loads(line) for line in f if line.strip())


def read_predictions(path: Path) -> dict[str, Pairs]:
    """pmcid -> pairs from a JSONL file of {"pmcid": ..., "pairs": [[position, slug], ...]}."""
    return {r["pmcid"]: {(int(p), str(s)) for p, s in r["pairs"]} for r in read_jsonl(path)}


def held_out_gold(con: duckdb.DuckDBPyConnection, split: dict[str, str]) -> dict[str, Pairs]:
    """The tags of every held-out article."""
    ids = [p for p, s in split.items() if s == "held_out"]
    gold: dict[str, Pairs] = {p: set() for p in ids}
    rows = con.execute(
        "SELECT pmcid, author_position, role FROM assignments WHERE pmcid IN (SELECT unnest(?))", [ids]
    ).fetchall()
    for pmcid, position, role in rows:
        gold[pmcid].add((position, role))
    return gold


def rule_predictions(con: duckdb.DuckDBPyConnection, pmcids: Iterable[str]) -> dict[str, Pairs]:
    """What the rule parser read from each tagged article's statement: its `paired` rows."""
    ids = list(pmcids)
    rows = con.execute(
        "SELECT pmcid, author_position, role FROM paired WHERE pmcid IN (SELECT unnest(?))", [ids]
    ).fetchall()
    predicted: dict[str, Pairs] = {p: set() for p in ids}
    for pmcid, position, role in rows:
        predicted[pmcid].add((position, role))
    return predicted


def hybrid(con: duckdb.DuckDBPyConnection, encoder: dict[str, Pairs]) -> dict[str, Pairs]:
    """The rules decide and the encoder reads: an article the rule parser gives no role keeps none, a
    `contrib_text` article keeps the rules' pairs (the encoder learned from statements, not per-author
    text), and every other article takes the encoder's pairs."""
    ids = list(encoder)
    sql = "SELECT pmcid, style FROM articles WHERE pmcid IN (SELECT unnest(?))"
    styles = dict(con.execute(sql, [ids]).fetchall())
    # A tagged article's rule reading is in `paired`; `assignments` holds its tags.
    rules = rule_predictions(con, [p for p in ids if styles.get(p) in TAGGED_STYLES])
    untagged = [p for p in ids if p not in rules]
    sql = "SELECT pmcid, author_position, role FROM assignments WHERE pmcid IN (SELECT unnest(?))"
    for pmcid, position, role in con.execute(sql, [untagged]).fetchall():
        rules.setdefault(pmcid, set()).add((position, role))
    return {
        p: rules.get(p, set()) if styles.get(p) == "contrib_text" or not rules.get(p) else pairs
        for p, pairs in encoder.items()
    }


def score(
    con: duckdb.DuckDBPyConnection, gold: dict[str, Pairs], predicted: dict[str, Pairs], by: str = "style"
) -> list[tuple]:
    """`labels.table` rows per style or publisher and for "(all)", every article weighing 1. An article
    missing from `predicted` predicts nothing."""
    column = "style" if by == "style" else "coalesce(publisher, '(no publisher)')"
    sql = f"SELECT pmcid, {column} FROM articles WHERE pmcid IN (SELECT unnest(?))"
    groups = dict(con.execute(sql, [list(gold)]).fetchall())
    return labels.table(
        (group, predicted.get(pmcid, set()), truth, 1.0)
        for pmcid, truth in gold.items()
        for group in ("(all)", groups.get(pmcid, "(not in database)"))
    )


# --- zero-shot baseline, from a local chat-completions server such as vLLM ---

MAX_TOKENS = 4000

SYSTEM = f"""You read author contribution statements from scientific articles and list the CRediT \
roles each author is given.

The 14 CRediT roles, by slug: {", ".join(ROLE_PATTERNS)}.

Rules:
- Use the numbered author list to resolve names and initials. Report authors by their number.
- Only report CRediT roles the statement assigns, in its own words or close synonyms of the role \
names ("writing - original draft preparation" is writing-original-draft). Prose such as "conceived \
the study" or "drew the figures" is not a CRediT role: leave it out.
- "All authors" given a role means every author in the list.
- Approval statements ("All authors read and approved the final manuscript") assign no role.
- If initials fit no author or several, leave them out rather than guess.
- If the statement assigns no CRediT roles, return an empty list."""

SCHEMA = {
    "type": "object",
    "properties": {
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "author": {"type": "integer"},
                    "roles": {"type": "array", "items": {"type": "string", "enum": list(ROLE_PATTERNS)}},
                },
                "required": ["author", "roles"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["assignments"],
    "additionalProperties": False,
}


def prompt(statement: str, authors: list[str]) -> str:
    numbered = "\n".join(f"{i}. {name}" for i, name in enumerate(authors, 1))
    return f"<authors>\n{numbered}\n</authors>\n\n<statement>\n{statement}\n</statement>"


def ask(base_url: str, model: str, statement: str, authors: list[str]) -> tuple[Pairs, dict[str, Any]]:
    """One statement through a chat-completions server: its pairs (positions outside the list dropped)
    and a log record. The server constrains the answer to SCHEMA. A refusal, a cut-off or an answer
    that does not parse counts as predicting nothing and is flagged in the record."""
    body = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt(statement, authors)}],
        "max_tokens": MAX_TOKENS,
        "temperature": 0,
        "response_format": {"type": "json_schema", "json_schema": {"name": "credit_roles", "schema": SCHEMA}},
        # vLLM passes this to the chat template: Qwen3-style models then answer without a reasoning block.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    request = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        answer = json.load(response)
    choice, usage = answer["choices"][0], answer.get("usage") or {}
    record: dict[str, Any] = {
        "finish_reason": choice.get("finish_reason"),
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
    }
    message = choice.get("message") or {}
    if record["finish_reason"] != "stop" or message.get("refusal"):
        return set(), record
    try:
        assignments = json.loads(message.get("content") or "")["assignments"]
        pairs = {(a["author"], role) for a in assignments if 1 <= a["author"] <= len(authors) for role in a["roles"]}
    except (ValueError, KeyError, TypeError) as error:
        return set(), record | {"error": f"unparsable answer: {error}"}
    return pairs, record


def run_zero_shot(
    base_url: str, model: str, items: Iterable[dict[str, Any]], out: Path, limit: int | None, workers: int
) -> tuple[int, int]:
    """Append one prediction line per item to `out` as answers arrive, skipping pmcids already there, so
    a stopped run resumes. `workers` requests run at once, which lets the server batch them. A request
    that fails (server down, HTTP error) writes nothing, so a rerun retries it. Returns (answered, failed)."""
    done = set(read_predictions(out)) if out.exists() else set()
    pending = [item for item in items if item["pmcid"] not in done][:limit]
    out.parent.mkdir(parents=True, exist_ok=True)
    answered = failed = 0
    with out.open("a", encoding="utf-8") as f, ThreadPoolExecutor(workers) as pool:
        futures = {pool.submit(ask, base_url, model, i["statement"], i["authors"]): i["pmcid"] for i in pending}
        for future in as_completed(futures):
            try:
                pairs, record = future.result()
            except (OSError, ValueError) as error:  # URLError and HTTPError are OSErrors
                failed += 1
                print(f"{futures[future]}: {error}", file=sys.stderr)
                continue
            f.write(json.dumps({"pmcid": futures[future], "pairs": sorted(pairs), **record}) + "\n")
            f.flush()
            answered += 1
    return answered, failed


def labelled_items(path: Path) -> Iterator[dict[str, Any]]:
    """Items in a CSV from `census label`: its `authors` cell reads "1. Name | 2. Name"."""
    for row in labels.read_rows(path):
        authors = [a.partition(". ")[2] for a in row["authors"].split(" | ")] if row["authors"] else []
        text = row["text"]
        if text[:1] == "'" and labels._cell(text[1:]) == text:  # undo the spreadsheet guard
            text = text[1:]
        yield {"pmcid": row["pmcid"], "statement": text, "authors": authors}
