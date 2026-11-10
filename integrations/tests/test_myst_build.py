"""Build the shared plugin through both document-engine entry points."""

import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


BUNDLE = ROOT / "src/core/dist/myst-plugin.mjs"


# The bundle is one file whatever the engine, so it needs only one real build.
@pytest.mark.parametrize(
    ("command", "extension", "source"),
    [(command, extension, "file") for command in ("myst", "jupyter-book") for extension in ("md", "ipynb")]
    + [("myst", "md", "bundle")],
)
def test_real_document_build(tmp_path, command, extension, source):
    plugin = ROOT / "integrations/myst/credit-matrix.mjs"
    env = dict(os.environ)
    if source == "bundle":
        # A user's project has no credit-matrix or yaml: the bundle is the only file.
        assert BUNDLE.exists(), "run `pnpm --filter credit-matrix build` first"
        # The fonts stay separate files, so the plugin download stays small.
        assert BUNDLE.stat().st_size < 3_000_000
        # Away from its package files, the bundle fetches fonts from the release, here a local copy.
        env["CREDIT_MATRIX_FIGURE_FONTS"] = (BUNDLE.parent / "figure-fonts").as_uri() + "/"
        plugin = tmp_path / "plugins" / "credit-matrix.mjs"
        plugin.parent.mkdir()
        plugin.write_bytes(BUNDLE.read_bytes())
    (tmp_path / "myst.yml").write_text(
        "version: 1\nproject:\n  title: Example Lab\n  authors:\n"
        "    - name: Marie Curie\n      roles: [Software, writing]\n"
        f"  plugins:\n    - {plugin}\n",
        encoding="utf-8",
    )
    text = "# Contributors\n\n:::{credit-statement}\n:::\n\n:::{credit-heatmap}\n:shape: circle\n:size: 30\n:legend: false\n:::\n"
    if extension == "ipynb":
        text = json.dumps(
            {
                "nbformat": 4,
                "nbformat_minor": 5,
                "metadata": {},
                "cells": [
                    {"id": "contributors", "cell_type": "markdown", "metadata": {}, "source": [text]},
                ],
            }
        )
    (tmp_path / f"index.{extension}").write_text(text, encoding="utf-8")
    result = subprocess.run(
        [
            str(ROOT / "node_modules/.bin" / command),
            "build",
            f"index.{extension}",
            "--md",
            "--strict",
            "--ci",
            "-o",
            "statement.md",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    statement = (tmp_path / "statement.md").read_text(encoding="utf-8")
    assert "**Marie Curie**: Software, Writing – original draft." in statement

    image = next((tmp_path / "_credit_matrix").glob("*.svg"))
    svg = image.read_text(encoding="utf-8")
    assert 'width="30" height="30" rx="15"' in svg
    assert "@font-face" in svg
    assert "base64," in svg
    assert ">Marie Curie</tspan>" in svg
    assert "<path" not in svg
    assert "<image" not in svg
    assert "_credit_matrix/" in statement
