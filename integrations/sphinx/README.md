# CRediT statement for Sphinx

Render a CRediT Matrix export in Sphinx documentation with a `credit-statement` directive.
The extension calls the [package CLI](../../src/core/README.md); it has no role list or
statement generator of its own.

## Install

1. Copy [credit_matrix.py](credit_matrix.py) into your documentation's `_ext/` folder.
2. Install the CLI beside your documentation project: `pnpm add -D credit-matrix`.
3. Add the extension and CLI path to `conf.py`:

   ```python
   from pathlib import Path
   import sys

   docs = Path(__file__).parent
   sys.path.insert(0, str(docs / "_ext"))
   extensions = ["credit_matrix"]  # add to your existing extensions
   credit_matrix_command = ["node", str(docs.parent / "node_modules/credit-matrix/dist/cli.js")]
   ```

Use Sphinx 8 or later with Python 3.11 or later. The CLI needs Node 22.19 or later.
If `credit-matrix` is already on your build's `PATH`, leave out `credit_matrix_command`.
The command is a list of arguments, not a shell command.

## Use

Export JSON from CRediT Matrix and save it beside your page as `contributors.json`:

```rst
Contributors
============

.. credit-statement:: contributors.json
   :levels:
```

The directive prints the statement at that position. Paths are relative to the page;
a leading `/` means the Sphinx source root. Changes to the export trigger a rebuild of the page.
The export is read during the documentation build, not by the reader's browser.

## Options

- `:format:` accepts `by-author` (default), `by-author-short`, `by-role` or `by-role-short`.
- `:locale:` overrides Sphinx's `language`. The default is English when no language is set.
  The CLI supports the app's nine languages and reports other languages as build errors.
  Traditional Chinese (`zh_TW`, `zh_HK`, `zh_Hant`) has no catalog and uses English.
- `:levels:` includes Equal and Supporting contribution levels.

Names and statements are inserted as text. They are never interpreted as reStructuredText or HTML.
Missing files, invalid exports and CLI errors appear as Sphinx diagnostics; use `sphinx-build -W`
to make them fail the build.

[`example/`](example) contains a complete project. From the repository root:

```sh
pnpm --filter credit-matrix build
uv run --project integrations sphinx-build -W -b html integrations/sphinx/example integrations/_build/sphinx
```

## Contribution heatmap

See [figure options and examples](../heatmap.md) for the `credit-heatmap` directive.
For your own font, give the directive `:font: Inter` and put the font files in the project.
`:font-path:` (comma-separated folders) and `credit_matrix_font_path` in `conf.py` (a list) resolve
against the folder of `conf.py`; `:ignore-system-fonts:` or `credit_matrix_ignore_system_fonts = True`
leaves out installed fonts, and `:font-fallback: sans|serif` picks the built-in faces for what the
family lacks. The file used shows as an info message, a license warning as a Sphinx warning, and a
missing family fails the directive with its page and line.

```python
credit_matrix_font_path = ["_fonts"]
credit_matrix_ignore_system_fonts = True
```

The CLI embeds fonts in the generated SVG. They come from `credit-matrix-fonts` when it is
installed, otherwise from a one-time download ([details](../../src/core/README.md#cli)). See
[font portability and PDF export](../figures/README.md) before converting it to PDF or Word.
