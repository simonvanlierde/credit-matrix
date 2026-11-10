"""Build real Sphinx projects against the published CLI entry point."""

import io
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from sphinx.testing.util import SphinxTestApp

ROOT = Path(__file__).resolve().parents[2]
EXTENSION = ROOT / "integrations/sphinx/credit_matrix.py"
EXPORT = ROOT / "integrations/sphinx/example/contributors.json"
CLI = ROOT / "src/core/dist/cli.js"


@pytest.fixture
def project(tmp_path):
    apps = []

    def build(directive=".. credit-statement:: contributors.json\n", language="en", command=None):
        source = tmp_path / "source"
        source.mkdir()
        (source / "_ext").mkdir()
        shutil.copyfile(EXTENSION, source / "_ext/credit_matrix.py")
        shutil.copyfile(EXPORT, source / "contributors.json")
        command = command or ["node", str(CLI)]
        (source / "conf.py").write_text(
            "import sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path(__file__).parent / '_ext'))\n"
            f"extensions = ['credit_matrix']\nproject = 'Example Lab'\nlanguage = {language!r}\n"
            f"credit_matrix_command = {command!r}\n",
            encoding="utf-8",
        )
        (source / "index.rst").write_text(f"Contributors\n============\n\n{directive}", encoding="utf-8")
        warnings = io.StringIO()
        app = SphinxTestApp(srcdir=source, builddir=tmp_path, status=io.StringIO(), warning=warnings)
        apps.append(app)
        return app, warnings, source

    yield build
    for app in apps:
        app.cleanup()


def test_statement_and_dependency_tracking(tmp_path, project):
    app, warnings, source = project()
    app.build()
    assert not warnings.getvalue()
    html = (tmp_path / "html/index.html").read_text(encoding="utf-8")
    assert "CRediT: Marie Curie: Conceptualization, Software; Albert Einstein: Formal analysis, Investigation" in html
    assert str(source / "contributors.json") in {str(p) for p in app.env.dependencies["index"]}
    data = (source / "contributors.json").read_text(encoding="utf-8").replace("Marie Curie", "Rosalind Franklin")
    (source / "contributors.json").write_text(data, encoding="utf-8")
    app.build()
    assert "Rosalind Franklin" in (tmp_path / "html/index.html").read_text(encoding="utf-8")


def test_levels_and_document_language(tmp_path, project):
    app, warnings, _ = project(".. credit-statement:: contributors.json\n   :levels:\n", "fr")
    app.build()
    assert not warnings.getvalue()
    html = (tmp_path / "html/index.html").read_text(encoding="utf-8")
    assert "Conceptualisation" in html
    assert "Logiciel(s) (Secondaire)" in html
    assert "Analyse formelle (Égal)" in html


def test_traditional_chinese_falls_back_to_english(tmp_path, project):
    app, warnings, _ = project(language="zh_TW")
    app.build()
    assert not warnings.getvalue()
    html = (tmp_path / "html/index.html").read_text(encoding="utf-8")
    assert "Conceptualization" in html


@pytest.mark.parametrize(
    "directive,diagnostic",
    [
        (".. credit-statement:: missing.json\n", "no such file"),
        (".. credit-statement:: contributors.json\n   :format: codemeta\n", "invalid option value"),
        (".. credit-statement:: contributors.json\n   :locale: xx\n", "Unknown locale"),
    ],
)
def test_errors_are_build_diagnostics(tmp_path, project, directive, diagnostic):
    app, warnings, _ = project(directive)
    app.build()
    assert diagnostic in warnings.getvalue()


def test_missing_cli_is_a_build_diagnostic(tmp_path, project):
    app, warnings, _ = project(command=[str(tmp_path / "missing-cli")])
    app.build()
    assert "Cannot run the credit-matrix CLI" in warnings.getvalue()


def test_names_are_text_not_markup(tmp_path, project):
    app, warnings, source = project()
    data = (source / "contributors.json").read_text(encoding="utf-8").replace("Marie Curie", "Marie <script> Curie")
    (source / "contributors.json").write_text(data, encoding="utf-8")
    app.build()
    assert not warnings.getvalue()
    assert "Marie &lt;script&gt; Curie" in (tmp_path / "html/index.html").read_text(encoding="utf-8")


def test_format_and_locale_override(tmp_path, project):
    app, warnings, _ = project(
        ".. credit-statement:: contributors.json\n   :format: by-role-short\n   :locale: en\n", "fr"
    )
    app.build()
    assert not warnings.getvalue()
    html = (tmp_path / "html/index.html").read_text(encoding="utf-8")
    assert "CRediT: Conceptualization: MC; Formal analysis: AE; Investigation: AE; Software: MC" in html


def test_invalid_export_is_a_build_diagnostic(tmp_path, project):
    app, warnings, source = project()
    (source / "contributors.json").write_text('{"version": 999, "authors": []}', encoding="utf-8")
    app.build()
    assert "newer than" in warnings.getvalue()


def test_unicode_output_under_non_utf8_locale(tmp_path, project):
    _, _, source = project(language="fr")
    output = tmp_path / "ascii-build"
    result = subprocess.run(
        [sys.executable, "-m", "sphinx", "-W", "-b", "html", str(source), str(output)],
        env={**os.environ, "LC_ALL": "C", "PYTHONUTF8": "0", "PYTHONCOERCECLOCALE": "0"},
        capture_output=True,
        encoding="utf-8",
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Analyse formelle" in (output / "index.html").read_text(encoding="utf-8")


def test_heatmap_is_an_image_with_accessible_statement(tmp_path, project):
    app, warnings, _ = project(
        ".. credit-heatmap:: contributors.json\n   :shape: circle\n   :size: 30\n   :font: serif\n   :font-size: 21\n   :initials: false\n   :legend: false\n"
    )
    app.build()
    assert not warnings.getvalue()
    html = (tmp_path / "html/index.html").read_text(encoding="utf-8")
    assert 'alt="CRediT: Marie Curie:' in html
    image = next((tmp_path / "html/_images").glob("*.svg"))
    svg = image.read_text(encoding="utf-8")
    assert 'width="30" height="30" rx="15"' in svg
    assert ">Supporting<" not in svg
    assert 'font-size="21"' in svg
    assert ">Marie Curie</text>" in svg
    assert "Georgia, 'Times New Roman', serif" in svg


@pytest.mark.parametrize("position", ["auto", "right", "bottom"])
@pytest.mark.parametrize("marks", [True, False])
def test_heatmap_forwards_legend_placement_and_optional_marks(tmp_path, project, position, marks):
    app, warnings, _ = project(
        f".. credit-heatmap:: contributors.json\n   :legend-position: {position}\n   :marks: {str(marks).lower()}\n"
    )
    app.build()
    assert not warnings.getvalue()
    svg = next((tmp_path / "html/_images").glob("*.svg")).read_text(encoding="utf-8")
    expected = subprocess.run(
        [
            "node",
            str(CLI),
            "convert",
            str(EXPORT),
            "--to",
            "svg",
            "--legend-position",
            position,
            "--marks",
            str(marks).lower(),
            "--locale",
            "en",
        ],
        check=True,
        capture_output=True,
        encoding="utf-8",
        timeout=30,
    )
    assert svg.strip() == expected.stdout.strip()
    assert ('aria-hidden="true"' in svg) == marks
