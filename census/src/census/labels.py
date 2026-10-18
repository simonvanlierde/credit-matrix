"""Hand-label a sample of statements, then score the parser against the labels.

`export` writes a CSV with each article's numbered authors and statement text and an empty `gold`
column. The parser's output is left out, so a label is not anchored to its guess. Fill `gold` like

    1: conceptualization, software; 2: writing - review & editing; all: validation

with author numbers from the `authors` column ("all" for every author), CRediT role names in any
wording the parser knows, and `none` for a statement that assigns no CRediT roles.

`export_set` writes the label set for the publishers `paired` cannot measure, stratified by
publisher, and `export_disagreements` a file of paired articles where the tags and the parser
disagree, to be judged by hand.
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
"""A publisher with this many articles in `paired_scores` is measured there and left out of the label set."""
MIN_SHARE = 0.005
"""A publisher with less than this share of a style's pool is sampled within "(other)"."""
DISAGREEMENT_PUBLISHER = "Multidisciplinary Digital Publishing Institute (MDPI)"
VERDICTS = ("tag", "parser", "both", "neither")
"""What a `wrong` cell in the disagreement file may say."""

# Counts articles the way the paired_scores view does: tagged, with a statement, and with a tag or a parsed role.
_COVERED = """
SELECT publisher FROM articles
WHERE style IN ('jats4r', 'plos_uri') AND statement IS NOT NULL
  AND (pmcid IN (SELECT pmcid FROM assignments) OR pmcid IN (SELECT pmcid FROM paired))
GROUP BY 1 HAVING count(*) >= ?
"""

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
    """`per_style` random articles with a statement for each text style, shuffled and without the style.
    Returns the row count."""
    rng = random.Random(seed)
    rows = []
    for style in TEXT_STYLES:
        pool = con.execute(
            "SELECT pmcid, authors, statement FROM articles WHERE statement IS NOT NULL AND style = ? ORDER BY pmcid",
            [style],
        ).fetchall()
        for pmcid, authors, text in rng.sample(pool, min(per_style, len(pool))):
            rows.append((pmcid, _numbered(authors), _cell(text), ""))
    rng.shuffle(rows)
    _write(path, ["pmcid", "authors", "text", "gold"], rows)
    return len(rows)


def key_path(path: Path) -> Path:
    """The key file `export_set` writes next to the label set: each article's stratum and weight."""
    return path.with_stem(path.stem + "-key")


def export_set(
    con: duckdb.DuckDBPyConnection, path: Path, seed: int, sizes: dict[str, int] = SET_SIZES, overlap: int = 25
) -> int:
    """The label set to `path` and its strata to `key_path(path)`; returns the row count.

    Each style's articles come from publishers with fewer than PAIRED_ENOUGH paired articles (all
    publishers for `none`, which is never paired), split over publishers by the square root of their
    size so the big ones get the most rows and the small ones still some. The key gives each article's
    stratum and its `weight`, the stratum's article count over the rows drawn from it, so `score`
    counts each row for the articles it stands for. `overlap` rows, drawn by the same seed, are marked
    for a second labeller. The labeller's file holds no style, stratum or weight, and its rows are
    shuffled, so nothing in it shows the parser's verdict.
    """
    rng = random.Random(seed)
    covered = {p for (p,) in con.execute(_COVERED, [PAIRED_ENOUGH]).fetchall()}
    picked = []
    for style, n in sizes.items():
        pool = con.execute(
            "SELECT pmcid, publisher FROM articles WHERE statement IS NOT NULL AND style = ? ORDER BY pmcid", [style]
        ).fetchall()
        pool = [(pmcid, p) for pmcid, p in pool if style == "none" or p not in covered]
        strata = _strata(pool)
        for stratum, quota in sorted(_allocate({k: len(v) for k, v in strata.items()}, n).items()):
            weight = f"{len(strata[stratum]) / quota:.6g}" if quota else ""
            picked += [(pmcid, stratum, weight) for pmcid in rng.sample(strata[stratum], quota)]
    second = set(rng.sample([pmcid for pmcid, _, _ in picked], min(overlap, len(picked))))
    rng.shuffle(picked)
    texts = _texts(con, [pmcid for pmcid, _, _ in picked])
    rows = [
        (pmcid, "1" if pmcid in second else "", _numbered(texts[pmcid][0]), _cell(texts[pmcid][1]), "")
        for pmcid, _, _ in picked
    ]
    _write(path, ["pmcid", "overlap", "authors", "text", "gold"], rows)
    _write(key_path(path), ["pmcid", "publisher", "weight"], sorted(picked))
    return len(rows)


def export_disagreements(con: duckdb.DuckDBPyConnection, path: Path, seed: int, n: int = 20) -> int:
    """`n` paired DISAGREEMENT_PUBLISHER articles where the tags and the parser differ, both shown, to
    `path`; returns the row count. It has its own random draw, so changing the label set leaves it alone."""
    ids = [p for (p,) in con.execute(_DISAGREEING, [DISAGREEMENT_PUBLISHER]).fetchall()]
    ids = sorted(random.Random(seed).sample(ids, min(n, len(ids))))
    texts = _texts(con, ids)
    rows = []
    for pmcid in ids:
        tags = set(con.execute("SELECT author_position, role FROM assignments WHERE pmcid = ?", [pmcid]).fetchall())
        parsed = set(con.execute("SELECT author_position, role FROM paired WHERE pmcid = ?", [pmcid]).fetchall())
        authors, text = texts[pmcid]
        rows.append(
            (pmcid, _numbered(authors), _cell(text), _pairs(tags), _pairs(tags - parsed), _pairs(parsed - tags), "", "")
        )
    _write(path, ["pmcid", "authors", "text", "tags", "only_tags", "only_parser", "wrong", "notes"], rows)
    return len(rows)


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
    """`n` split over strata in proportion to the square root of their size, by largest remainder. A
    stratum smaller than its share gives all it has, and the rest is split over the others."""
    full: dict[str, int] = {}
    while True:
        rest = {k: s for k, s in sizes.items() if k not in full}
        left = n - sum(full.values())
        total = sum(math.sqrt(s) for s in rest.values())
        exact = {k: left * math.sqrt(s) / total for k, s in rest.items()} if total else {}
        quota = {k: int(x) for k, x in exact.items()}
        for k in sorted(exact, key=lambda k: (quota[k] - exact[k], k))[: left - sum(quota.values())]:
            quota[k] += 1
        short = {k: sizes[k] for k in quota if quota[k] > sizes[k]}
        if not short:
            return full | quota
        full |= short


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


def _article(con: duckdb.DuckDBPyConnection, pmcid: str) -> tuple[int, str, str]:
    """Author count, publisher and style of an article in the database."""
    found = con.execute("SELECT n_authors, publisher, style FROM articles WHERE pmcid = ?", [pmcid]).fetchone()
    if found is None:
        raise ValueError(f"{pmcid}: not in this database")
    return found[0] or 0, found[1] or "(no publisher)", found[2]


def _gold(row: dict[str, str], n_authors: int) -> set[tuple[int, str]]:
    try:
        return parse_gold(row["gold"], n_authors)
    except ValueError as error:
        raise ValueError(f"{row['pmcid']}: {error}") from error


def _add(c: list[float], predicted: set, gold: set, weight: float = 1.0) -> None:
    """Adds one article to weighted tp, fp, fn, exact, weight and squared weight, and the unweighted count."""
    for i, x in enumerate((len(predicted & gold), len(predicted - gold), len(gold - predicted), predicted == gold, 1)):
        c[i] += weight * x
    c[5] += weight * weight
    c[6] += 1


def _rates(tp: float, fp: float, fn: float, exact: float, w: float, w2: float, n: float) -> tuple:
    """Articles, precision, recall, F1, the share exactly right and its 95% interval. A rate with
    nothing to count is None: precision when nothing was predicted, recall when nothing was to be found."""
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else None
    share = exact / w
    low, high = _wilson(share, w * w / w2)
    return int(n), *(None if x is None else round(x, 3) for x in (precision, recall, f1, share, low, high))


def _wilson(p: float, n: float, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a share `p` of `n` articles. With weighted rows `n` is the effective
    sample size, the squared sum of the weights over the sum of their squares."""
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return centre - half, centre + half


def score(con: duckdb.DuckDBPyConnection, path: Path, by: str = "style", key: Path | None = None) -> list[tuple]:
    """Precision, recall and F1 over (author, role) pairs, and the share of articles exactly right with
    its 95% interval, per style or per style and publisher. The style is the database's. The stratum
    and weight come from `key` (by default `key_path(path)` when it exists); without a key file each
    row weighs 1 under the database's publisher. The article count is unweighted."""
    key = key or key_path(path)
    strata = {}
    if key.exists():
        with key.open(newline="", encoding="utf-8-sig") as f:
            strata = {r["pmcid"]: (r["publisher"], float(r["weight"])) for r in csv.DictReader(f)}
    counts: dict[str, list[float]] = defaultdict(lambda: [0.0] * 7)
    for row in _labelled(path):
        n_authors, publisher, style = _article(con, row["pmcid"])
        if strata and row["pmcid"] not in strata:
            raise ValueError(f"{row['pmcid']}: not in {key}")
        publisher, weight = strata.get(row["pmcid"], (publisher, 1.0))
        predicted = set(
            con.execute("SELECT author_position, role FROM assignments WHERE pmcid = ?", [row["pmcid"]]).fetchall()
        )
        group = style if by == "style" else f"{style}: {publisher}"
        _add(counts[group], predicted, _gold(row, n_authors), weight)
    return [(group, *_rates(*c)) for group, c in sorted(counts.items())]


def agreement(con: duckdb.DuckDBPyConnection, first: Path, second: Path) -> tuple:
    """The second labeller scored against the first on the overlap rows both labelled, as one unweighted
    `score` row."""
    a = {r["pmcid"]: r for r in _labelled(first) if r.get("overlap") == "1"}
    c = [0.0] * 7
    for row in _labelled(second):
        if row["pmcid"] in a:
            n_authors, _, _ = _article(con, row["pmcid"])
            _add(c, _gold(row, n_authors), _gold(a[row["pmcid"]], n_authors))
    if not c[6]:
        raise ValueError(f"{first} and {second} share no labelled overlap article")
    return _rates(*c)


def verdicts(path: Path) -> Counter[str]:
    """How often the disagreement file says the tag, the parser, both or neither was wrong."""
    with path.open(newline="", encoding="utf-8-sig") as f:
        counts = Counter(r["wrong"].strip().lower() for r in csv.DictReader(f) if r["wrong"].strip())
    if bad := sorted(set(counts) - set(VERDICTS)):
        raise ValueError(f"wrong is {', '.join(bad)}; use one of {', '.join(VERDICTS)}")
    return counts
