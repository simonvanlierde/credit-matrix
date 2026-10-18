"""Hand-label a sample of statements, then score the parser against the labels.

`export` writes a CSV with each article's numbered authors and statement text and an empty `gold`
column. The parser's output is left out, so a label is not anchored to its guess. Fill `gold` like

    1: conceptualization, software; 2: writing - review & editing; all: validation

with author numbers from the `authors` column ("all" for every author), CRediT role names in any
wording the parser knows, and `none` for a statement that assigns no CRediT roles.

`export_set` writes the label set for the publishers `paired` cannot measure, stratified by
publisher, plus a file of paired articles where the tags and the parser disagree, to be judged by hand.
"""

import csv
import math
import random
from collections import Counter, defaultdict
from pathlib import Path

import duckdb

from census.roles import clean, find_roles

# Styles read from free text, which is where parsing can go wrong. jats4r and plos_uri are machine tags.
TEXT_STYLES = ("statement_text", "contrib_text", "none")

SET_SIZES = {"statement_text": 100, "contrib_text": 30, "none": 30}
"""Articles per style in the label set. `none` rows have a contributions text with no CRediT roles
found, so their labels count the statements the parser missed."""
PAIRED_ENOUGH = 1000
"""A publisher with this many articles in `paired` is measured there and left out of the label set."""
MIN_SHARE = 0.005
"""A publisher with less than this share of a style's pool is sampled within "(other)"."""
DISAGREEMENT_PUBLISHER = "Multidisciplinary Digital Publishing Institute (MDPI)"
VERDICTS = ("tag", "parser", "both", "neither")
"""What a `wrong` cell in the disagreement file may say."""

_DISAGREEING = """
WITH t AS (
    SELECT pmcid FROM articles WHERE publisher = ? AND style IN ('jats4r', 'plos_uri') AND statement IS NOT NULL
),
g AS (SELECT pmcid, author_position, role FROM assignments WHERE pmcid IN (SELECT pmcid FROM t)),
p AS (SELECT pmcid, author_position, role FROM paired WHERE pmcid IN (SELECT pmcid FROM t))
SELECT DISTINCT pmcid FROM g FULL JOIN p USING (pmcid, author_position, role)
WHERE g.role IS NULL OR p.role IS NULL ORDER BY pmcid
"""


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
            rows.append((pmcid, style_, _numbered(authors), _cell(text), ""))
    _write(path, ["pmcid", "style", "authors", "text", "gold"], rows)
    return len(rows)


def export_set(
    con: duckdb.DuckDBPyConnection,
    path: Path,
    disagreements_path: Path,
    seed: int,
    sizes: dict[str, int] = SET_SIZES,
    overlap: int = 25,
    disagreements: int = 20,
) -> tuple[int, int]:
    """The label set to `path` and the disagreements to `disagreements_path`; returns both row counts.

    Each style's articles come from publishers with fewer than PAIRED_ENOUGH paired articles (all
    publishers for `none`, which is never paired), split over publishers by the square root of their
    size so the big ones get the most rows and the small ones still some. `overlap` rows, drawn by the
    same seed, are marked for a second labeller.
    """
    rng = random.Random(seed)
    covered = {
        p
        for (p,) in con.execute(
            "SELECT a.publisher FROM (SELECT DISTINCT pmcid FROM paired) JOIN articles a USING (pmcid)"
            " GROUP BY 1 HAVING count(*) >= ?",
            [PAIRED_ENOUGH],
        ).fetchall()
    }
    picked = []
    for style, n in sizes.items():
        pool = con.execute(
            "SELECT pmcid, publisher FROM articles WHERE statement IS NOT NULL AND style = ? ORDER BY pmcid", [style]
        ).fetchall()
        pool = [(pmcid, p) for pmcid, p in pool if style == "none" or p not in covered]
        strata = _strata(pool)
        for stratum, quota in sorted(_allocate({k: len(v) for k, v in strata.items()}, n).items()):
            picked += [
                (pmcid, stratum, style) for pmcid in rng.sample(strata[stratum], min(quota, len(strata[stratum])))
            ]
    second = set(rng.sample([pmcid for pmcid, _, _ in picked], min(overlap, len(picked))))
    texts = _texts(con, [pmcid for pmcid, _, _ in picked])
    rows = [
        (pmcid, stratum, style, "1" if pmcid in second else "", _numbered(texts[pmcid][0]), _cell(texts[pmcid][1]), "")
        for pmcid, stratum, style in picked
    ]
    _write(path, ["pmcid", "publisher", "style", "overlap", "authors", "text", "gold"], rows)

    ids = [p for (p,) in con.execute(_DISAGREEING, [DISAGREEMENT_PUBLISHER]).fetchall()]
    ids = sorted(rng.sample(ids, min(disagreements, len(ids))))
    texts = _texts(con, ids)
    rows = []
    for pmcid in ids:
        tags = set(con.execute("SELECT author_position, role FROM assignments WHERE pmcid = ?", [pmcid]).fetchall())
        parsed = set(con.execute("SELECT author_position, role FROM paired WHERE pmcid = ?", [pmcid]).fetchall())
        authors, text = texts[pmcid]
        rows.append(
            (pmcid, _numbered(authors), _cell(text), _pairs(tags), _pairs(tags - parsed), _pairs(parsed - tags), "", "")
        )
    header = ["pmcid", "authors", "text", "tags", "only_tags", "only_parser", "wrong", "notes"]
    _write(disagreements_path, header, rows)
    return len(picked), len(rows)


def _strata(pool: list[tuple[str, str | None]]) -> dict[str, list[str]]:
    """PMCIDs per publisher, the publishers under MIN_SHARE of the pool pooled into "(other)"."""
    by_publisher: dict[str, list[str]] = defaultdict(list)
    for pmcid, publisher in pool:
        by_publisher[publisher or "(no publisher)"].append(pmcid)
    strata: dict[str, list[str]] = defaultdict(list)
    for publisher, ids in by_publisher.items():
        strata[publisher if len(ids) >= MIN_SHARE * len(pool) else "(other)"] += ids
    return strata


def _allocate(sizes: dict[str, int], n: int) -> dict[str, int]:
    """`n` split over strata in proportion to the square root of their size, by largest remainder."""
    total = sum(math.sqrt(s) for s in sizes.values())
    exact = {k: n * math.sqrt(s) / total for k, s in sizes.items()} if total else {}
    quota = {k: int(x) for k, x in exact.items()}
    for k in sorted(exact, key=lambda k: (quota[k] - exact[k], k))[: n - sum(quota.values())]:
        quota[k] += 1
    return quota


def _texts(con: duckdb.DuckDBPyConnection, ids: list[str]) -> dict[str, tuple[list[str], str]]:
    found = con.execute("SELECT pmcid, authors, statement FROM articles WHERE pmcid IN (SELECT unnest(?))", [ids])
    return {pmcid: (authors or [], text or "") for pmcid, authors, text in found.fetchall()}


def _numbered(authors: list[str]) -> str:
    return " | ".join(f"{i}. {name}" for i, name in enumerate(authors, 1))


def _pairs(pairs: set[tuple[int, str]]) -> str:
    """(position, slug) pairs written the way a `gold` cell is: "1: software, validation; 2: resources"."""
    roles: dict[int, list[str]] = defaultdict(list)
    for position, slug in sorted(pairs):
        roles[position].append(slug.replace("-", " "))
    return "; ".join(f"{p}: {', '.join(r)}" for p, r in roles.items())


def _write(path: Path, header: list[str], rows: list[tuple]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig so a spreadsheet opened for labelling shows the names right.
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def _cell(text: str) -> str:
    """Article text, defused for spreadsheets: a leading = + - @ would run as a formula."""
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def parse_gold(gold: str, n_authors: int) -> set[tuple[int, str]]:
    """(author position, role slug) pairs in a `gold` cell."""
    if gold.strip().lower() == "none":
        return set()
    pairs = set()
    for part in filter(str.strip, gold.split(";")):
        who, colon, roles = part.partition(":")
        who = who.strip().lower()
        if not colon or (who != "all" and not (who.isascii() and who.isdigit())):
            raise ValueError(f"{part.strip()!r}: author is neither a number nor 'all'")
        if who != "all" and not 1 <= int(who) <= n_authors:
            raise ValueError(f"{part.strip()!r}: the article has {n_authors} authors")
        slugs = {slug for _, _, slug in find_roles(clean(roles))}
        if not slugs:
            raise ValueError(f"{part.strip()!r}: no CRediT role found")
        positions = range(1, n_authors + 1) if who == "all" else [int(who)]
        pairs |= {(p, slug) for p in positions for slug in slugs}
    return pairs


def _labelled(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return [r for r in csv.DictReader(f) if r["gold"].strip()]


def _article(con: duckdb.DuckDBPyConnection, pmcid: str) -> tuple[int, str]:
    """Author count and publisher of an article in the database."""
    found = con.execute("SELECT n_authors, publisher FROM articles WHERE pmcid = ?", [pmcid]).fetchone()
    if found is None:
        raise ValueError(f"{pmcid}: not in this database")
    return found[0] or 0, found[1] or "(no publisher)"


def _gold(row: dict[str, str], n_authors: int) -> set[tuple[int, str]]:
    try:
        return parse_gold(row["gold"], n_authors)
    except ValueError as error:
        raise ValueError(f"{row['pmcid']}: {error}") from error


def _add(c: list[int], predicted: set, gold: set) -> None:
    c[0] += len(predicted & gold)
    c[1] += len(predicted - gold)
    c[2] += len(gold - predicted)
    c[3] += predicted == gold
    c[4] += 1


def _rates(tp: int, fp: int, fn: int, exact: int, n: int) -> tuple:
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return n, round(precision, 3), round(recall, 3), round(f1, 3), round(exact / n, 3)


def score(con: duckdb.DuckDBPyConnection, path: Path, by: str = "style") -> list[tuple]:
    """Precision, recall and F1 over (author, role) pairs, and the share of articles exactly right, per
    style or per publisher (the CSV's `publisher` stratum when it has one, else the database's)."""
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0, 0])  # tp, fp, fn, exact, articles
    for row in _labelled(path):
        n_authors, publisher = _article(con, row["pmcid"])
        predicted = set(
            con.execute("SELECT author_position, role FROM assignments WHERE pmcid = ?", [row["pmcid"]]).fetchall()
        )
        key = row["style"] if by == "style" else row.get("publisher") or publisher
        _add(counts[key], predicted, _gold(row, n_authors))
    return [(key, *_rates(*c)) for key, c in sorted(counts.items())]


def agreement(con: duckdb.DuckDBPyConnection, first: Path, second: Path) -> tuple:
    """The second labeller scored against the first on the articles both labelled, as one `score` row."""
    a = {r["pmcid"]: r for r in _labelled(first)}
    c = [0, 0, 0, 0, 0]
    for row in _labelled(second):
        if row["pmcid"] in a:
            n_authors, _ = _article(con, row["pmcid"])
            _add(c, _gold(row, n_authors), _gold(a[row["pmcid"]], n_authors))
    if not c[4]:
        raise ValueError(f"{first} and {second} share no labelled article")
    return _rates(*c)


def verdicts(path: Path) -> Counter[str]:
    """How often the disagreement file says the tag, the parser, both or neither was wrong."""
    with path.open(newline="", encoding="utf-8-sig") as f:
        counts = Counter(r["wrong"].strip().lower() for r in csv.DictReader(f) if r["wrong"].strip())
    if bad := sorted(set(counts) - set(VERDICTS)):
        raise ValueError(f"wrong is {', '.join(bad)}; use one of {', '.join(VERDICTS)}")
    return counts
