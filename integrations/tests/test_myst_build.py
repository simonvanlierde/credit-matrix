"""Build the shared plugin through both document-engine entry points."""

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("command", ["myst", "jupyter-book"])
@pytest.mark.parametrize("extension", ["md", "ipynb"])
def test_real_document_build(tmp_path, command, extension):
    plugin = ROOT / "integrations/myst/credit-matrix.mjs"
    (tmp_path / "myst.yml").write_text(
        "version: 1\nproject:\n  title: Example Lab\n  authors:\n"
        "    - name: Marie Curie\n      roles: [Software, writing]\n"
        f"  plugins:\n    - {plugin}\n",
        encoding="utf-8",
    )
    text = "# Contributors\n\n:::{credit-statement}\n:::\n"
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
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    statement = (tmp_path / "statement.md").read_text(encoding="utf-8")
    assert "**Marie Curie**: Software, Writing – original draft." in statement
