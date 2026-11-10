"""Feed exported manuscript YAML through the actual document plugins."""

import subprocess
from pathlib import Path

import pypandoc
import pytest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "src/core/dist/cli.js"
FILTER = ROOT / "integrations/quarto/_extensions/credit-matrix/credit-matrix.lua"


@pytest.mark.parametrize("format", ["quarto", "myst"])
def test_exported_frontmatter_renders_the_app_statement(tmp_path, format):
    roster = tmp_path / "team.csv"
    roster.write_text("Name,Conceptualization,Software\nLin Wei,100,33\nEva Novak,0,66\n", encoding="utf-8")
    yaml = subprocess.run(
        ["node", str(CLI), "convert", str(roster), "--to", format],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    statement = (
        subprocess.run(
            ["node", str(CLI), "statement", str(roster), "--format", "by-author"]
            + (["--levels"] if format == "quarto" else []),
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .removeprefix("CRediT: ")
    )
    if format == "quarto":
        result = subprocess.run(
            [pypandoc.get_pandoc_path(), "--from=markdown", "--to=plain", "--wrap=none", f"--lua-filter={FILTER}"],
            input=f"---\n{yaml}---\n\n# Methods\n",
            capture_output=True,
            text=True,
            check=True,
        )
        rendered = result.stdout
    else:
        plugin = ROOT / "src/core/dist/myst-plugin.mjs"
        (tmp_path / "myst.yml").write_text(
            "version: 1\nproject:\n  title: Example\n"
            + "\n".join(f"  {line}" for line in yaml.splitlines())
            + f"\n  plugins:\n    - {plugin}\n",
            encoding="utf-8",
        )
        (tmp_path / "index.md").write_text("# Contributors\n\n:::{credit-statement}\n:::\n", encoding="utf-8")
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
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        rendered = (tmp_path / "statement.md").read_text(encoding="utf-8").replace("**", "")
    assert f"{statement}." in rendered
