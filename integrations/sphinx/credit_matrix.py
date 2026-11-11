"""Render a CRediT Matrix export through the package's CLI during a Sphinx build."""

import hashlib
import os
import subprocess
from pathlib import Path
from xml.etree import ElementTree

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.application import Sphinx
from sphinx.util import logging
from sphinx.util.docutils import SphinxDirective

logger = logging.getLogger(__name__)


def statement_format(value: str) -> str:
    return directives.choice(value, ("by-author", "by-author-short", "by-role", "by-role-short"))


class CreditStatement(SphinxDirective):
    required_arguments = 1
    final_argument_whitespace = True
    option_spec = {  # noqa: RUF012 - Docutils reads options from the directive class.
        "format": statement_format,
        "locale": directives.unchanged_required,
        "levels": directives.flag,
    }

    def run(self) -> list[nodes.Node]:
        _, filename = self.env.relfn2path(self.arguments[0])
        self.env.note_dependency(filename)
        locale = self.options.get("locale", self.config.language or "en").replace("_", "-")
        command = [
            *self.config.credit_matrix_command,
            "statement",
            filename,
            "--format",
            self.options.get("format", "by-author"),
            "--locale",
            locale,
        ]
        if "levels" in self.options:
            command.append("--levels")
        result = self.render(command)
        # Keep names and statements as text, rather than interpreting them as reStructuredText.
        return [nodes.paragraph(text=line) for line in result.strip().split("\n\n")]

    def render(self, command: list[str]) -> str:
        try:
            # Room for the first download of a CJK figure font (up to 15 MB) on a slow link.
            result = subprocess.run(command, check=True, capture_output=True, encoding="utf-8", timeout=300)
        except subprocess.CalledProcessError as error:
            raise self.error(f"CRediT rendering failed: {error.stderr.strip()}") from error
        except (OSError, subprocess.TimeoutExpired) as error:
            raise self.error(f"Cannot run the credit-matrix CLI: {error}") from error
        # The CLI's own lines become messages on this directive; other stderr, such as a Node notice,
        # does not. The font it drew with is info; its warnings (a heatmap that prints too small, a
        # font licence) are build warnings that suppress_warnings = ["credit_matrix"] silences.
        for line in result.stderr.splitlines():
            if not line.startswith("credit-matrix: "):
                continue
            if line.startswith("credit-matrix: font: "):
                logger.info("credit-heatmap: %s", line.removeprefix("credit-matrix: "), location=self.get_location())
            else:
                logger.warning(line, location=self.get_location(), type="credit_matrix", subtype="cli")
        return result.stdout


def font_fallback(value: str) -> str:
    return directives.choice(value, ("sans", "serif"))


def boolean(value: str) -> str:
    return directives.choice(value, ("true", "false"))


class CreditHeatmap(CreditStatement):
    option_spec = {  # noqa: RUF012 - Docutils reads options from the directive class.
        **{
            key: directives.unchanged_required
            for key in ("color", "palette", "shape", "size", "font", "font-size", "labels", "locale", "legend-position")
        },
        "font-path": directives.unchanged_required,
        "font-fallback": font_fallback,
        "ignore-system-fonts": directives.flag,
        **{key: boolean for key in ("legend", "levels", "skipempty", "initials", "marks")},
        "horizontal": directives.flag,
    }

    def run(self) -> list[nodes.Node]:
        _, filename = self.env.relfn2path(self.arguments[0])
        self.env.note_dependency(filename)
        command = [*self.config.credit_matrix_command, "convert", filename, "--to", "svg"]
        for key, value in self.options.items():
            if key == "horizontal":
                command.append("--horizontal")
            elif key in ("font-path", "ignore-system-fonts"):
                continue  # Added below, with the conf values.
            elif key == "levels":
                if value == "false":
                    command.append("--yes-no")
            else:
                command.extend(("--" + key, value))
        # Folders resolve against the folder of conf.py; the directive's come first, as they are searched first.
        folders = [*self.options.get("font-path", "").split(","), *self.config.credit_matrix_font_path]
        for folder in filter(None, (f.strip() for f in folders)):
            command.extend(("--font-path", str(Path(self.config.credit_matrix_confdir) / folder)))
        if "ignore-system-fonts" in self.options or self.config.credit_matrix_ignore_system_fonts:
            command.append("--ignore-system-fonts")
        if "locale" not in self.options:
            command.extend(("--locale", (self.config.language or "en").replace("_", "-")))
        svg = self.render(command)
        name = hashlib.sha256(svg.encode()).hexdigest()[:20] + ".svg"
        target = Path(self.env.srcdir) / "_credit_matrix" / name
        target.parent.mkdir(exist_ok=True)
        target.write_text(svg, encoding="utf-8")
        root = ElementTree.fromstring(svg)
        alt = root.findtext("{http://www.w3.org/2000/svg}desc", default="Contribution heatmap")
        source = Path(self.env.doc2path(self.env.docname)).parent
        return [nodes.image(uri=os.path.relpath(target, source), alt=alt)]


def setup(app: Sphinx) -> dict[str, object]:
    app.add_config_value("credit_matrix_command", ["credit-matrix"], "env", types={list})
    app.add_config_value("credit_matrix_confdir", "", "env", types={str})
    app.connect("config-inited", lambda app, config: setattr(config, "credit_matrix_confdir", str(app.confdir)))
    app.add_config_value("credit_matrix_font_path", [], "env", types={list})
    app.add_config_value("credit_matrix_ignore_system_fonts", False, "env", types={bool})
    app.add_directive("credit-statement", CreditStatement)
    app.add_directive("credit-heatmap", CreditHeatmap)
    return {"parallel_read_safe": True, "parallel_write_safe": True}
