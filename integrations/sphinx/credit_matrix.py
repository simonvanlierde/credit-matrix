"""Render a CRediT Matrix export through the package's CLI during a Sphinx build."""

import subprocess

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.application import Sphinx
from sphinx.util.docutils import SphinxDirective


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
        try:
            result = subprocess.run(command, check=True, capture_output=True, encoding="utf-8", timeout=30)
        except subprocess.CalledProcessError as error:
            raise self.error(f"CRediT statement failed: {error.stderr.strip()}") from error
        except (OSError, subprocess.TimeoutExpired) as error:
            raise self.error(f"Cannot run the credit-matrix CLI: {error}") from error
        # Keep names and statements as text, rather than interpreting them as reStructuredText.
        return [nodes.paragraph(text=line) for line in result.stdout.strip().split("\n\n")]


def setup(app: Sphinx) -> dict[str, object]:
    app.add_config_value("credit_matrix_command", ["credit-matrix"], "env", types={list})
    app.add_directive("credit-statement", CreditStatement)
    return {"parallel_read_safe": True, "parallel_write_safe": True}
