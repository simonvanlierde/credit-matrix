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
            result = subprocess.run(command, check=True, capture_output=True, encoding="utf-8", timeout=30)
        except subprocess.CalledProcessError as error:
            raise self.error(f"CRediT rendering failed: {error.stderr.strip()}") from error
        except (OSError, subprocess.TimeoutExpired) as error:
            raise self.error(f"Cannot run the credit-matrix CLI: {error}") from error
        # The CLI's warnings (a heatmap that prints too small) become build warnings on this directive.
        for line in result.stderr.splitlines():
            if line.strip():
                logger.warning(line.strip(), location=self.get_location())
        return result.stdout


def boolean(value: str) -> str:
    return directives.choice(value, ("true", "false"))


class CreditHeatmap(CreditStatement):
    option_spec = {  # noqa: RUF012 - Docutils reads options from the directive class.
        **{
            key: directives.unchanged_required
            for key in ("color", "palette", "shape", "size", "font", "font-size", "labels", "locale", "legend-position")
        },
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
            elif key == "levels":
                if value == "false":
                    command.append("--yes-no")
            else:
                command.extend(("--" + key, value))
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
    app.add_directive("credit-statement", CreditStatement)
    app.add_directive("credit-heatmap", CreditHeatmap)
    return {"parallel_read_safe": True, "parallel_write_safe": True}
