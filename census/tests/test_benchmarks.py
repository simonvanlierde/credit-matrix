"""CodSpeed benchmarks for the census's CPU-bound steps: reading JATS and parsing statements.

Under plain `pytest` each benchmark runs once, as a smoke test. In CI they are measured with

    uv run --locked pytest tests/test_benchmarks.py --codspeed
"""

import json
from pathlib import Path
from xml.sax.saxutils import escape

import pytest
from helpers import article, contrib

from census.jats import parse_article
from census.roles import clean, find_roles, names_credit
from census.statement import Author, parse_statement

CASES = [json.loads(line) for line in Path(__file__).with_name("corpus.jsonl").read_text().splitlines()]
STATEMENTS = [case["statement"] for case in CASES]
PARSE_INPUTS = [(case["statement"], [Author(g, s) for g, s in case["authors"]]) for case in CASES]

# The longest real statement, with its own byline, as a JATS article whose roles live in the back matter.
_LONGEST = max(CASES, key=lambda case: len(case["statement"]))
STATEMENT_XML = article(
    "".join(contrib(escape(g), escape(s)) for g, s in _LONGEST["authors"]),
    f'<notes notes-type="author-contribution"><p>{escape(_LONGEST["statement"])}</p></notes>',
)
# A PLOS-style article: every author tagged with CRediT role URIs.
_ROLES = ["conceptualization", "software", "validation", "writing-original-draft", "writing-review-editing"]
TAGGED_XML = article(
    "".join(
        contrib(
            f"Given{i}",
            f"Surname{i}",
            "".join(
                f'<role content-type="http://credit.niso.org/contributor-roles/{slug}/">{slug}</role>'
                for slug in _ROLES[: 1 + i % len(_ROLES)]
            ),
        )
        for i in range(40)
    )
)


@pytest.mark.benchmark
def test_parse_statement_corpus():
    for text, authors in PARSE_INPUTS:
        parse_statement(text, authors)


@pytest.mark.benchmark
def test_find_roles_corpus():
    for text in STATEMENTS:
        find_roles(clean(text))


@pytest.mark.benchmark
def test_names_credit_corpus():
    for text in STATEMENTS:
        names_credit(text)


def test_parse_article_statement(benchmark):
    result = benchmark(parse_article, STATEMENT_XML)
    assert result.assignments


def test_parse_article_tagged_roles(benchmark):
    result = benchmark(parse_article, TAGGED_XML)
    assert result.style == "plos_uri"
