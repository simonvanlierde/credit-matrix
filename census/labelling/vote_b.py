"""Majority vote over three definition-B labellers: vote_b.py NAME.

Reads oa-2026-10-NAME.csv and NAME-parts/opus-{a,b,c}-*.jsonl (chunks). Two labels agree when they give the
same (author, role) pairs, the same degrees and the same pledges; quotes, mentions and evidence
may differ. Prints pairwise exact agreement on that key and on the general view alone, split by
the stratum in oa-2026-10-NAME-key.csv when there is one. Writes NAME-splits.jsonl (rows with no
majority, all three labels) and, once NAME-adjudicated.jsonl covers every split, NAME-gold.jsonl."""

import json
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

from census import labels

LAB = Path(__file__).resolve().parents[1] / "data/labels"
NAME = sys.argv[1]
base = {r["pmcid"]: r for r in labels.read_rows(LAB / f"oa-2026-10-{NAME}.csv")}


def load(*paths: Path) -> dict[str, list]:
    out = {}
    for line in (line for path in paths for line in path.open(encoding="utf-8")):
        item = json.loads(line)
        r = base[item["pmcid"]]
        out[item["pmcid"]] = labels.check_label(item["label"], r["text"], r["authors"].count(" | ") + 1)
    return out


def key(label: list) -> tuple:
    # Evidence is left out: the pilot's labellers split on named/worded/inferred far more than on the
    # roles themselves, so it is recorded but neither voted on nor trained on.
    pairs = {(n, labels.ROLE_NAMES[r["role"]]) for a in label for r in a.get("roles", []) for n in a["authors"]}
    pledged = {n for a in label if "pledge" in a for n in a["authors"]}
    return frozenset(pairs), frozenset(labels.label_degrees(label).items()), frozenset(pledged)


parts = {w: load(*sorted((LAB / f"{NAME}-parts").glob(f"opus-{w}-*.jsonl"))) for w in "abc"}
for w, p in parts.items():
    if p.keys() != base.keys():
        sys.exit(f"labeller {w}: {len(p)} rows, {len(base.keys() - p.keys())} missing")

key_file = LAB / f"oa-2026-10-{NAME}-key.csv"
stratum = {r["pmcid"]: r["stratum"] for r in labels.read_rows(key_file)} if key_file.exists() else {}
strata = defaultdict(list)
for k in base:
    strata[stratum.get(k, "all")].append(k)
for s, ks in sorted(strata.items()):
    for x, y in combinations("abc", 2):
        full = sum(key(parts[x][k]) == key(parts[y][k]) for k in ks) / len(ks)
        general = sum(labels.label_pairs(parts[x][k]) == labels.label_pairs(parts[y][k]) for k in ks) / len(ks)
        print(f"{s} ({len(ks)}) {x} vs {y}: exact {full:.3f}, general view {general:.3f}")

gold, splits = {}, []
for k in base:
    votes = Counter(key(parts[w][k]) for w in "abc")
    top, n = votes.most_common(1)[0]
    if n >= 2:
        gold[k] = next(parts[w][k] for w in "abc" if key(parts[w][k]) == top)
    else:
        splits.append(
            {"pmcid": k, "authors": base[k]["authors"], "text": base[k]["text"], **{w: parts[w][k] for w in "abc"}}
        )
print(f"majority {len(gold)}, splits {len(splits)}")
with (LAB / f"{NAME}-splits.jsonl").open("w", encoding="utf-8") as f:
    f.writelines(json.dumps(s, ensure_ascii=False) + "\n" for s in splits)

adjudicated = LAB / f"{NAME}-adjudicated.jsonl"
if adjudicated.exists():
    fixed = load(adjudicated)
    missing = {s["pmcid"] for s in splits} - fixed.keys()
    if missing:
        sys.exit(f"adjudicated file misses {len(missing)} splits")
    gold |= {k: fixed[k] for k in fixed if k not in gold}
    with (LAB / f"{NAME}-gold.jsonl").open("w", encoding="utf-8") as f:
        f.writelines(json.dumps({"pmcid": k, "label": gold[k]}, ensure_ascii=False) + "\n" for k in base)
    print(f"{NAME}-gold.jsonl {len(gold)} rows")
