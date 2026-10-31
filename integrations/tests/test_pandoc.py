"""Exercise the standalone Lua filter through Pandoc's real metadata and writers."""

import json
import subprocess
from pathlib import Path

import pypandoc
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

ROOT = Path(__file__).resolve().parents[2]
FILTER = ROOT / "integrations/quarto/_extensions/credit-matrix/credit-matrix.lua"


def render(metadata: dict, body: str = "# Methods\n\nBody.\n", writer: str = "plain") -> str:
    source = f"---\n{json.dumps(metadata, ensure_ascii=False)}\n---\n\n{body}"
    result = subprocess.run(
        [pypandoc.get_pandoc_path(), "--from=markdown", f"--to={writer}", "--wrap=none", f"--lua-filter={FILTER}"],
        input=source,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


@pytest.mark.parametrize("key", ["author", "authors"])
def test_plain_pandoc_roles_and_levels(key):
    result = render(
        {
            key: [
                {"name": "Marie Curie", "roles": ["writing", {"software": "supporting"}, "conceptualisation"]},
                {"name": {"given": "Albert", "family": "Einstein"}, "roles": [{"analysis": "equal"}, "investigation"]},
            ]
        }
    )
    assert (
        "Marie Curie: Conceptualization, Software (Supporting), Writing – original draft; "
        "Albert Einstein: Formal analysis (Equal), Investigation."
    ) in result


def test_quarto_normalized_metadata():
    result = render(
        {
            "authors": [
                {
                    "name": {"literal": "Marie Curie"},
                    "roles": [
                        {"vocab-term": "software", "degree-of-contribution": "equal"},
                        {"vocab-term": "writing – original draft"},
                    ],
                }
            ]
        }
    )
    assert "Marie Curie: Software (Equal), Writing – original draft." in result


def test_single_author_and_single_role():
    assert "Marie Curie: Software." in render({"author": {"name": "Marie Curie", "roles": "software"}})
    assert "CRediT authorship" not in render({"author": "Marie Curie"})
    assert "CRediT authorship" not in render({"author": [{"name": "Marie Curie", "roles": ["Coffee"]}]})


def test_placement_and_custom_heading():
    meta = {
        "author": [{"name": "Marie Curie", "roles": ["software"]}],
        "credit-matrix": {"heading": "Contributions", "placement": "start"},
    }
    result = render(meta)
    assert result.index("Contributions") < result.index("Methods")
    result = render(meta, "# Methods\n\nBefore.\n\n::: {#credit-statement}\n:::\n\nAfter.\n")
    assert result.index("Before.") < result.index("Marie Curie: Software.") < result.index("After.")
    assert result.count("Marie Curie: Software.") == 1


def test_names_are_text_in_html():
    result = render(
        {"author": [{"name": "Marie <script>alert(1)</script> Curie", "roles": ["software"]}]}, writer="html"
    )
    assert "<script>" not in result


@given(st.permutations(["software", "validation", "writing", "software"]))
@settings(max_examples=12)
def test_role_order_and_deduplication(roles):
    result = render({"author": [{"name": "Marie Curie", "roles": list(roles)}]})
    assert "Marie Curie: Software, Validation, Writing – original draft." in result


def test_duplicate_roles_keep_the_strongest_level():
    result = render(
        {
            "author": [
                {
                    "name": "Marie Curie",
                    "roles": [
                        {"software": "supporting"},
                        {"software": "equal"},
                        "software",
                    ],
                }
            ]
        }
    )
    assert "Marie Curie: Software." in result


def test_spelling_variants_and_unknown_roles():
    result = render(
        {
            "author": [
                {
                    "name": "Marie Curie",
                    "roles": [
                        "VISUALISATION",
                        "Writing - Review and Editing",
                        "Coffee",
                        False,
                    ],
                }
            ]
        }
    )
    assert "Marie Curie: Visualization, Writing – review & editing." in result
