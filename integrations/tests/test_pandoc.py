"""Exercise the standalone Lua filter through Pandoc's real metadata and writers."""

import json
import os
import subprocess
from pathlib import Path

import pypandoc
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

ROOT = Path(__file__).resolve().parents[2]
FILTER = ROOT / "integrations/quarto/_extensions/credit-matrix/credit-matrix.lua"


CLI = ROOT / "src/core/dist/cli.js"
LOCAL_CLI = {"CREDIT_MATRIX_COMMAND": f"node {CLI}"}


def render(
    metadata: dict, body: str = "# Methods\n\nBody.\n", writer: str = "plain", *args: str, env: dict | None = None
) -> str:
    source = f"---\n{json.dumps(metadata, ensure_ascii=False)}\n---\n\n{body}"
    result = subprocess.run(
        [
            pypandoc.get_pandoc_path(),
            "--from=markdown",
            f"--to={writer}",
            "--wrap=none",
            f"--lua-filter={FILTER}",
            *args,
        ],
        input=source,
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, **(env or {})},
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


def test_title_block_prints_author_names():
    # Pandoc's templates print an author map as "true"; the filter leaves only the name.
    result = render(
        {
            "title": "Paper",
            "author": [
                {"name": "Marie Skłodowska-Curie", "roles": ["writing"]},
                {"name": {"given": "Antonie", "family": "van Leeuwenhoek"}, "roles": ["investigation"]},
            ],
        },
        "# Methods\n\nBody.\n",
        "latex",
        "--standalone",
    )
    assert "\\author{Marie Skłodowska-Curie \\and Antonie van Leeuwenhoek}" in result


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


def test_jats_keeps_the_author_map():
    result = render(
        {
            "title": "Paper",
            "author": [
                {
                    "name": "Marie Skłodowska-Curie",
                    "orcid": "0000-0002-1825-0097",
                    "email": "marie@example.org",
                    "roles": ["writing"],
                }
            ],
        },
        "# Methods\n\nBody.\n",
        "jats",
        "--standalone",
    )
    assert "0000-0002-1825-0097" in result


def test_custom_template_keeps_the_author_map(tmp_path):
    template = tmp_path / "authors.txt"
    template.write_text("$for(author)$$author.name$|$author.affiliation$$endfor$\n$body$\n")
    result = render(
        {"author": [{"name": "Tu Youyou", "affiliation": "Example Lab", "roles": ["investigation"]}]},
        "# Methods\n\nBody.\n",
        "plain",
        f"--template={template}",
    )
    assert "Tu Youyou|Example Lab" in result


def test_single_author_map_prints_the_name():
    result = render(
        {"title": "Paper", "author": {"name": "Antonie van Leeuwenhoek", "roles": ["investigation"]}},
        "# Methods\n\nBody.\n",
        "latex",
        "--standalone",
    )
    assert "\\author{Antonie van Leeuwenhoek}" in result


@pytest.mark.parametrize("levels", [True, False])
def test_heatmap_uses_shared_renderer_and_embeds_accessible_image(tmp_path, levels):
    metadata = {
        "author": [{"name": "Tu Youyou", "roles": [{"software": "supporting"}]}],
        "credit-matrix": {
            "heatmap": True,
            "shape": "circle",
            "size": 30,
            "font": "serif",
            "font-size": 21,
            "initials": False,
            "legend": False,
            "levels": levels,
        },
    }
    html = render(metadata, "# Methods\n", "html", f"--extract-media={tmp_path}", env=LOCAL_CLI)
    expected = "Tu Youyou: Software (Supporting)." if levels else "Tu Youyou: Software."
    assert f'alt="{expected}"' in html
    svg = next(tmp_path.rglob("*.svg")).read_text(encoding="utf-8")
    assert 'width="30" height="30" rx="15"' in svg
    assert ">Supporting<" not in svg
    assert 'font-size="21"' in svg
    assert ">Tu Youyou</tspan>" in svg
    assert "Noto Serif" in svg


def test_heatmap_too_small_to_print_warns_on_stderr(tmp_path):
    people = [{"name": f"Grace Hopper {i}", "roles": [{"software": "lead"}]} for i in range(40)]
    source = f"---\n{json.dumps({'author': people, 'credit-matrix': {'heatmap': True}})}\n---\n\n# Methods\n"
    result = subprocess.run(
        [pypandoc.get_pandoc_path(), "--to=html", f"--extract-media={tmp_path}", f"--lua-filter={FILTER}"],
        input=source,
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, **LOCAL_CLI},
    )
    assert "smallest labels print at about" in result.stderr
    assert next(tmp_path.rglob("*.svg"))


@pytest.mark.parametrize("position", ["auto", "right", "bottom"])
@pytest.mark.parametrize("marks", [True, False])
def test_heatmap_forwards_legend_placement_and_optional_marks(tmp_path, position, marks):
    cli = str(CLI)
    metadata = {
        "author": [{"name": "Tu Youyou", "roles": [{"software": "supporting"}]}],
        "credit-matrix": {"heatmap": True, "legend-position": position, "marks": marks},
    }
    render(metadata, "# Methods\n", "html", f"--extract-media={tmp_path}", env=LOCAL_CLI)
    svg = next(tmp_path.rglob("*.svg")).read_text(encoding="utf-8")
    expected = subprocess.run(
        ["node", cli, "convert", "-", "--to", "svg", "--legend-position", position, "--marks", str(marks).lower()],
        input="Name,Software\nTu Youyou,33\n",
        check=True,
        capture_output=True,
        encoding="utf-8",
        timeout=30,
    )
    assert svg.strip() == expected.stdout.strip()
    assert ('aria-hidden="true"' in svg) == marks


def test_heatmap_command_comes_from_the_environment_not_the_document(tmp_path):
    metadata = {
        "author": [{"name": "Tu Youyou", "roles": ["software"]}],
        "credit-matrix": {"heatmap": True, "command": [False]},
    }
    html = render(metadata, "# Methods\n", "html", f"--extract-media={tmp_path}", env=LOCAL_CLI)
    assert 'alt="Tu Youyou: Software."' in html
    assert next(tmp_path.rglob("*.svg")).read_text(encoding="utf-8").startswith("<svg")
    with pytest.raises(subprocess.CalledProcessError) as error:
        render(metadata, "# Methods\n", "html", env={"CREDIT_MATRIX_COMMAND": "credit-matrix-missing --flag"})
    assert "credit-matrix-missing" in error.value.stderr
