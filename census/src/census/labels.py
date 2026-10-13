"""Hand-label a sample of statements, then score the parser against the labels.

`export` writes a CSV with each article's numbered authors and statement text and an empty `gold`
column. The parser's output is left out, so a label is not anchored to its guess. Fill `gold` like

    1: conceptualization, software; 2: writing - review & editing; all: validation

with author numbers from the `authors` column ("all" for every author), CRediT role names in any
wording the parser knows, and `none` for a statement that assigns no CRediT roles.
"""

import csv
import random
from collections import defaultdict
from pathlib import Path

import duckdb

from census.roles import clean, find_roles

# Styles read from free text, which is where parsing can go wrong. jats4r and plos_uri are machine tags.
TEXT_STYLES = ("statement_text", "contrib_text", "none")


def export(con: duckdb.DuckDBPyConnection, path: Path, per_style: int, seed: int) -> int:
    """`per_style` random articles with a statement for each text style. Returns the row count."""
    rng = random.Random(seed)
    rows = []
    for style in TEXT_STYLES:
        pool = con.execute(
            "SELECT pmcid, style, authors, statement FROM articles WHERE statement IS NOT NULL AND style = ?"
            " ORDER BY pmcid",
            [style],
        ).fetchall()
        for pmcid, style_, authors, text in rng.sample(pool, min(per_style, len(pool))):
            numbered = " | ".join(f"{i}. {name}" for i, name in enumerate(authors, 1))
            rows.append((pmcid, style_, numbered, _cell(text), ""))
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["pmcid", "style", "authors", "text", "gold"])
        writer.writerows(rows)
    return len(rows)


def _cell(text: str) -> str:
    """Article text, defused for spreadsheets: a leading = + - @ would run as a formula."""
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def parse_gold(gold: str, n_authors: int) -> set[tuple[int, str]]:
    """(author position, role slug) pairs in a `gold` cell."""
    if gold.strip().lower() == "none":
        return set()
    pairs = set()
    for part in gold.split(";"):
        who, _, roles = part.partition(":")
        who = who.strip().lower()
        if not roles.strip():
            continue
        if who != "all" and not who.isdigit():
            raise ValueError(f"author {who!r} is neither a number nor 'all'")
        positions = range(1, n_authors + 1) if who == "all" else [int(who)]
        pairs |= {(p, slug) for p in positions for _, _, slug in find_roles(clean(roles))}
    return pairs


def score(con: duckdb.DuckDBPyConnection, path: Path) -> list[tuple]:
    """Precision, recall and F1 over (author, role) pairs, and the share of articles exactly right, per style."""
    with path.open(newline="") as f:
        labelled = [r for r in csv.DictReader(f) if r["gold"].strip()]
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0, 0])  # tp, fp, fn, exact, articles
    for row in labelled:
        n_authors = con.execute("SELECT n_authors FROM articles WHERE pmcid = ?", [row["pmcid"]]).fetchone()
        predicted = set(
            con.execute("SELECT author_position, role FROM assignments WHERE pmcid = ?", [row["pmcid"]]).fetchall()
        )
        try:
            gold = parse_gold(row["gold"], n_authors[0] if n_authors else 0)
        except ValueError as error:
            raise ValueError(f"{row['pmcid']}: {error}") from error
        c = counts[row["style"]]
        c[0] += len(predicted & gold)
        c[1] += len(predicted - gold)
        c[2] += len(gold - predicted)
        c[3] += predicted == gold
        c[4] += 1
    results = []
    for style, (tp, fp, fn, exact, n) in sorted(counts.items()):
        precision = tp / (tp + fp) if tp + fp else 1.0
        recall = tp / (tp + fn) if tp + fn else 1.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        results.append((style, n, round(precision, 3), round(recall, 3), round(f1, 3), round(exact / n, 3)))
    return results
