"""Build the shared plugin through both document-engine entry points."""

import json
import os
import shutil
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
def test_real_document_build(tmp_path, figure_font_cache, command, extension, source):
    plugin = ROOT / "integrations/myst/credit-matrix.mjs"
    env = dict(os.environ)
    if source == "bundle":
        # A user's project has no credit-matrix or yaml: the bundle is the only file.
        assert BUNDLE.exists(), "run `pnpm --filter credit-matrix build` first"
        # The fonts are not in the bundle, so the plugin download stays small.
        assert BUNDLE.stat().st_size < 3_000_000
        # Away from its package, the bundle reads the faces from the machine's font cache.
        env.update(figure_font_cache)
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


FONTS = ROOT / "src/core/__tests__/fixtures/fonts"


@pytest.mark.parametrize("family", ["Figure Test Serif", "No Such Family"])
def test_font_path_is_relative_to_the_project(tmp_path, figure_font_cache, family):
    (tmp_path / "fonts").mkdir()
    shutil.copyfile(FONTS / "FigureTestSerif-Regular.ttf", tmp_path / "fonts/FigureTestSerif-Regular.ttf")
    (tmp_path / "myst.yml").write_text(
        "version: 1\nproject:\n  title: Example Lab\n  authors:\n"
        "    - name: Marie Curie\n      roles: [Software]\n"
        f"  plugins:\n    - {ROOT / 'integrations/myst/credit-matrix.mjs'}\n",
        encoding="utf-8",
    )
    (tmp_path / "index.md").write_text(
        f"# Contributors\n\n:::{{credit-heatmap}}\n:font: {family}\n:font-path: fonts\n:ignore-system-fonts: true\n:::\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [str(ROOT / "node_modules/.bin/myst"), "build", "index.md", "--md", "--strict", "--ci", "-o", "out.md"],
        cwd=tmp_path,
        env={**os.environ, **figure_font_cache},
        capture_output=True,
        text=True,
        timeout=60,
    )
    output = result.stdout + result.stderr
    if family == "No Such Family":
        # `myst build --md` exits 0 on a fatal message, as it does for any other; --strict fails site and PDF builds.
        line = next(line for line in output.splitlines() if "Cannot find the font family" in line)
        assert "index.md credit-heatmap: Cannot find the font family No Such Family in the font path" in line
        assert not (tmp_path / "_credit_matrix").exists()
        return
    assert result.returncode == 0, output
    svg = next((tmp_path / "_credit_matrix").glob("*.svg")).read_text(encoding="utf-8")
    assert "font-family:'Figure Test Serif'" in svg
