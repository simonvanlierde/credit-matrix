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


# --- the whole corpus: free-text statements, read by a model and by the rule parser ---

_FREE_TEXT = "FROM articles WHERE style IN ('statement_text', 'contrib_text') AND statement IS NOT NULL"


def count_free_text(con: duckdb.DuckDBPyConnection, limit: int | None = None) -> int:
    (n,) = con.execute(f"SELECT count(*) {_FREE_TEXT}").fetchone() or (0,)
    return min(n, limit) if limit else n


def free_text_chunks(con: duckdb.DuckDBPyConnection, size: int, limit: int | None = None) -> Iterator[list[dict]]:
    """Every article whose roles the rule parser read from free text, in pmcid order, `size` at a time."""
    cursor = con.execute(
        f"SELECT pmcid, statement, coalesce(authors, []) {_FREE_TEXT} ORDER BY pmcid LIMIT ?", [limit or 2**62]
    )
    while batch := cursor.fetchmany(size):
        yield [{"pmcid": p, "statement": s, "authors": a} for p, s, a in batch]


COMPARISON = {
    "Research articles with roles, per year (tagged articles as tagged; free text by each reader)": """
        WITH per AS (
            SELECT a.year, a.n_authors_with_roles > 0 AS rules,
                   CASE WHEN c.pmcid IS NULL THEN a.n_authors_with_roles > 0 ELSE c.n > 0 END AS model
            FROM articles a LEFT JOIN covered c USING (pmcid)
            WHERE a.article_type = 'research-article' AND a.year IS NOT NULL
        )
        SELECT year, count(*) AS articles, round(avg(rules::INT), 3) AS rules, round(avg(model::INT), 3) AS model
        FROM per GROUP BY year ORDER BY year""",
    "Share of authors with a role holding each role, by byline position (free-text research articles, 3+ authors)": """
        WITH arts AS (
            SELECT a.pmcid, a.n_authors FROM articles a JOIN covered USING (pmcid)
            WHERE a.article_type = 'research-article' AND a.n_authors > 2
        ),
        pairs AS (
            SELECT 'rules' AS reader, pmcid, author_position, role FROM assignments
            WHERE pmcid IN (SELECT pmcid FROM arts)
            UNION ALL
            SELECT 'model', pmcid, author_position, role FROM model WHERE pmcid IN (SELECT pmcid FROM arts)
        ),
        placed AS (
            SELECT p.*, CASE WHEN author_position = 1 THEN 'first' WHEN author_position = a.n_authors THEN 'last'
                        ELSE 'middle' END AS place
            FROM pairs p JOIN arts a USING (pmcid)
        ),
        holders AS (SELECT reader, place, count(DISTINCT (pmcid, author_position)) AS n FROM placed GROUP BY ALL)
        SELECT role, reader, place, round(count(*) / any_value(h.n), 3) AS share, any_value(h.n) AS authors_with_roles
        FROM placed JOIN holders h USING (reader, place) GROUP BY ALL ORDER BY role, place, reader""",
    "Rules against the model per publisher (free-text articles; pair F1 of one against the other)": """
        WITH r AS (SELECT pmcid, author_position, role FROM assignments WHERE pmcid IN (SELECT pmcid FROM covered)),
        both_ AS (
            SELECT pmcid, r.role IS NOT NULL AS by_rules, m.role IS NOT NULL AS by_model
            FROM r FULL JOIN model m USING (pmcid, author_position, role)
        ),
        per AS (
            SELECT pmcid, bool_and(by_rules = by_model) AS same, count(*) FILTER (by_rules AND by_model) AS hits,
                   count(*) FILTER (by_rules) AS n_rules, count(*) FILTER (by_model) AS n_model
            FROM both_ GROUP BY pmcid
        ),
        pub AS (
            SELECT CASE WHEN grouping(a.publisher) = 1 THEN '(all)' ELSE coalesce(a.publisher, '(no publisher)') END
                       AS publisher,
                   count(*) AS articles, avg(coalesce(p.same, true)::INT) AS same,
                   sum(coalesce(hits, 0)) AS hits, sum(coalesce(n_rules, 0) + coalesce(n_model, 0)) AS pairs
            FROM covered c JOIN articles a USING (pmcid) LEFT JOIN per p USING (pmcid) GROUP BY ROLLUP (a.publisher)
        )
        SELECT publisher, articles, round(same, 3) AS same_pairs, round(2 * hits / nullif(pairs, 0), 3) AS pair_f1
        FROM pub ORDER BY publisher <> '(all)', articles DESC LIMIT 31""",
}
"""`covered` holds (pmcid, n) for each article the model read, n its pairs; `model` its pairs."""


def compare(con: duckdb.DuckDBPyConnection, parts: str) -> dict[str, list[dict[str, Any]]]:
    """COMPARISON's tables for the model's Parquet parts (a glob of `encoder.predict_corpus` output)."""
    source = f"read_parquet('{parts}')"
    con.execute(f"CREATE OR REPLACE TEMP VIEW model AS SELECT * FROM {source} WHERE role IS NOT NULL")
    con.execute(f"CREATE OR REPLACE TEMP VIEW covered AS SELECT pmcid, count(role) AS n FROM {source} GROUP BY pmcid")
    tables = {}
    for title, sql in COMPARISON.items():
        cursor = con.execute(sql)
        columns = [d[0] for d in cursor.description or ()]
        tables[title] = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
    return tables


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
