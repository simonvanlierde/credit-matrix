# CRediT statement for Sphinx

The `credit-statement` directive renders a CRediT Matrix export in your Sphinx documentation.
It calls the [package CLI](../../src/core/README.md) and has no role list or statement generator
of its own.

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

This needs Sphinx 8 or later, Python 3.11 or later and, for the CLI, Node 22.19 or later.
If `credit-matrix` is already on your build's `PATH`, leave out `credit_matrix_command`.
The command is a list of arguments, not a shell command.

## Use

Export JSON from CRediT Matrix and save it beside your page as `contributors.json`:

<!-- live: sphinx -->

```rst
Contributors
============

.. credit-statement:: contributors.json
   :levels:
```

The directive prints the statement at that position. Paths are relative to the page; a leading `/`
means the Sphinx source root. A change to the export rebuilds the page. The build reads the export,
not the reader's browser.

## Options

- `:format:` accepts `by-author` (default), `by-author-short`, `by-role` or `by-role-short`.
- `:locale:` overrides Sphinx's `language`. With no language set, it is English.
  The CLI supports the app's nine languages and reports any other as a build error.
  Traditional Chinese (`zh_TW`, `zh_HK`, `zh_Hant`) has no catalog and uses English.
- `:levels:` includes Equal and Supporting contribution levels.

Names and statements go in as text, never as reStructuredText or HTML. Missing files, invalid
exports and CLI errors appear as Sphinx diagnostics. Use `sphinx-build -W` to fail the build on them.

[`example/`](example/) is a complete project. To build it, run this from the repository root:

```sh
pnpm --filter credit-matrix build
uv run --project integrations sphinx-build -W -b html integrations/sphinx/example integrations/_build/sphinx
```

## Contribution heatmap

See [figure options and examples](../heatmap.md) for the `credit-heatmap` directive. From about
25 contributors it warns that the labels print under 6 pt, which fails a strict build. The
[final-size checks](../heatmap.md#final-size-readability-checks) say how to silence it.

For your own font, give the directive `:font: Inter` and put the font files in the project.
`:font-path:` and `credit_matrix_font_path` resolve against the folder of `conf.py`, and the other
font options work as in the [options table](../heatmap.md#your-own-font). A `:font-path:` folder name
cannot contain a comma. For one that does, use `credit_matrix_font_path` (a list) in `conf.py`:

```python
credit_matrix_font_path = ["_fonts"]
credit_matrix_ignore_system_fonts = True
```

The CLI embeds fonts in the generated SVG. They come from `credit-matrix-fonts` when it is
installed, otherwise from a one-time download
([fonts and offline use](../../docs/cli.md#fonts-and-offline-use)).
Before you convert the SVG to PDF or Word, read
[font portability and PDF export](../figures/README.md).
