"""Document languages reach statements and figures through the installed engines."""

import json
import os
import subprocess
from pathlib import Path
from xml.etree import ElementTree

import pypandoc
import pytest

ROOT = Path(__file__).resolve().parents[2]
FILTER = ROOT / "integrations/quarto/_extensions/credit-matrix/credit-matrix.lua"


@pytest.mark.parametrize(
    ("lang", "locale", "heading"), [("fr-CA", "fr", "Déclaration CRediT"), ("ja-JP", "ja", "CRediT 声明")]
)
@pytest.mark.parametrize("engine", ["pandoc", "myst"])
def test_document_language(tmp_path, lang, locale, heading, engine):
    roster = tmp_path / "team.csv"
    roster.write_text("Name,Software,Validation\nLin Wei,33,66\nEva Novak,100,100\n", encoding="utf-8")
    command = [
        "node",
        str(ROOT / "src/core/dist/cli.js"),
        "statement",
        str(roster),
        "--format",
        "by-author",
        "--locale",
        locale,
    ]
    if engine == "pandoc":
        command.append("--levels")
    expected = (
        subprocess.run(command, capture_output=True, text=True, check=True).stdout.strip().removeprefix("CRediT: ")
    )
    authors = [
        {
            "name": "Lin Wei",
            "roles": [{"software": "supporting"}, {"validation": "equal"}]
            if engine == "pandoc"
            else ["Software", "Validation"],
        },
        {"name": "Eva Novak", "roles": ["Software", "Validation"]},
    ]
    if engine == "pandoc":
        source = "---\n" + json.dumps({"lang": lang, "author": authors}, ensure_ascii=False) + "\n---\n\n# Methods\n"
        result = subprocess.run(
            [pypandoc.get_pandoc_path(), "--from=markdown", "--to=plain", "--wrap=none", f"--lua-filter={FILTER}"],
            input=source,
            capture_output=True,
            text=True,
            check=True,
        )
        rendered = result.stdout
        assert heading in rendered
    else:
        # Copy only the published bundle: no dependency can be resolved from this project.
        plugin = tmp_path / "plugin.mjs"
        plugin.write_bytes((ROOT / "src/core/dist/myst-plugin.mjs").read_bytes())
        # Away from its package files, the bundle fetches fonts from the release, here a local copy.
        fonts = {"CREDIT_MATRIX_FIGURE_FONTS": (ROOT / "src/core/dist/figure-fonts").as_uri() + "/"}
        (tmp_path / "myst.yml").write_text(
            "version: 1\nproject:\n  title: Example\n  lang: en\n  plugins:\n    - " + str(plugin) + "\n",
            encoding="utf-8",
        )
        frontmatter = json.dumps({"lang": lang, "authors": authors}, ensure_ascii=False)
        (tmp_path / "index.md").write_text(
            f"---\n{frontmatter}\n---\n\n# Contributors\n\n:::{{credit-statement}}\n:::\n\n:::{{credit-heatmap}}\n:::\n",
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                str(ROOT / "node_modules/.bin/myst"),
                "build",
                "index.md",
                "--md",
                "--strict",
                "--ci",
                "-o",
                "statement.md",
            ],
            cwd=tmp_path,
            env={**os.environ, **fonts},
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        rendered = (tmp_path / "statement.md").read_text(encoding="utf-8").replace("**", "")
        svg = next((tmp_path / "_credit_matrix").glob("*.svg")).read_text(encoding="utf-8")
        assert f'lang="{locale}"' in svg
        assert ElementTree.fromstring(svg).findtext("{http://www.w3.org/2000/svg}desc") == f"CRediT: {expected}"
    assert expected in rendered


@pytest.mark.parametrize(
    ("tag", "locale"),
    [(locale, locale) for locale in ("en", "fr", "de", "es", "it", "pt-PT", "nl", "zh-Hans", "ja")]
    + [
        ("de-DE", "de"),
        ("pt-BR", "pt-PT"),
        ("zh-CN", "zh-Hans"),
        ("zh-TW", "en"),
        ("zh-Hant", "en"),
        ("zh-HK", "en"),
        ("zh-Hans-TW", "zh-Hans"),
        ("unknown", "en"),
    ],
)
def test_pandoc_locale_fallback_and_custom_heading(tmp_path, tag, locale):
    roster = tmp_path / "team.csv"
    roster.write_text("Name,Software,Validation\nLin Wei,33,66\n", encoding="utf-8")
    expected = (
        subprocess.run(
            [
                "node",
                str(ROOT / "src/core/dist/cli.js"),
                "statement",
                str(roster),
                "--format",
                "by-author",
                "--levels",
                "--locale",
                locale,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .removeprefix("CRediT: ")
    )
    metadata = {
        "lang": tag,
        "author": [{"name": "Lin Wei", "roles": [{"software": "supporting"}, {"validation": "equal"}]}],
        "credit-matrix": {"heading": "Chosen heading"},
    }
    result = subprocess.run(
        [pypandoc.get_pandoc_path(), "--from=markdown", "--to=plain", "--wrap=none", f"--lua-filter={FILTER}"],
        input="---\n" + json.dumps(metadata, ensure_ascii=False) + "\n---\n",
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Chosen heading" in result.stdout
    assert f"{expected}." in result.stdout


@pytest.mark.parametrize("override", [None, "ja-JP"])
def test_pandoc_heatmap_language(tmp_path, override):
    metadata = {
        "lang": "fr-CA",
        "author": [{"name": "Lin Wei", "roles": ["software"]}],
        "credit-matrix": {
            "heatmap": True,
            **({"locale": override} if override else {}),
        },
    }
    result = subprocess.run(
        [
            pypandoc.get_pandoc_path(),
            "--from=markdown",
            "--to=html",
            f"--lua-filter={FILTER}",
            f"--extract-media={tmp_path}",
        ],
        input="---\n" + json.dumps(metadata, ensure_ascii=False) + "\n---\n",
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "CREDIT_MATRIX_COMMAND": f"node {ROOT / 'src/core/dist/cli.js'}"},
    )
    svg = next(tmp_path.rglob("*.svg")).read_text(encoding="utf-8")
    locale, role = ("ja", "ソフトウェア") if override else ("fr", "Logiciel(s)")
    assert f'lang="{locale}"' in svg
    assert role in svg
    assert role in result.stdout
