"""Real statements with the roles their publishers tagged in the XML, pinned against the parser.

Each line of corpus.jsonl is one open-access article under CC BY or CC0 (the licence and PMCID travel
with the text). `gold` is the tagged roles, `expected` and `expected_unresolved` are what the parser
returned when the corpus was last updated; both are sorted [author index, role slug] pairs, 0-based.
Gold is sometimes wrong (a publisher tags the wrong author) and so is the parser: both are kept.

The first test fails on any change in parser output. After a deliberate change, rewrite `expected`
from the current output (gold is never touched), then review the diff of corpus.jsonl:

    CENSUS_UPDATE_CORPUS=1 uv run pytest -q tests/test_corpus.py
"""

import json
import os
from pathlib import Path

import pytest

from census.statement import Author, parse_statement

PATH = Path(__file__).with_name("corpus.jsonl")
CASES = [json.loads(line) for line in PATH.read_text().splitlines()]
F1_FLOOR = 0.93  # a little under the value when the corpus was written (0.9443)


def run(case):
    parsed = parse_statement(case["statement"], [Author(g, s) for g, s in case["authors"]])
    return sorted([i, role] for i, role in parsed.assignments), parsed.unresolved


if os.environ.get("CENSUS_UPDATE_CORPUS"):
    for case in CASES:
        case["expected"], case["expected_unresolved"] = run(case)
    PATH.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in CASES))


@pytest.mark.parametrize("case", CASES, ids=[c["pmcid"] for c in CASES])
def test_parser_output_is_pinned(case):
    assert run(case) == (case["expected"], case["expected_unresolved"])


def test_f1_against_tags_holds():
    pairs = lambda key: {(c["pmcid"], i, role) for c in CASES for i, role in c[key]}  # noqa: E731
    got, gold = pairs("expected"), pairs("gold")
    precision, recall = len(got & gold) / len(got), len(got & gold) / len(gold)
    f1 = 2 * precision * recall / (precision + recall)
    print(f"corpus micro F1 {f1:.4f} (precision {precision:.4f}, recall {recall:.4f})")
    assert f1 >= F1_FLOOR
