# CRediT statement for Jupyter Book 2

Jupyter Book 2 uses the MyST document engine. It runs our [MyST plugin](../myst/README.md)
directly; there is no second plugin to copy or configure.

## Install

1. Copy [credit-matrix.mjs](../myst/credit-matrix.mjs) into your book.
2. Install its dependencies: `pnpm add credit-matrix yaml`.
3. Add it to `myst.yml`:

   ```yaml
   version: 1
   project:
     title: Example Lab handbook
     authors:
       - name: Marie Curie
         roles: [Software, writing]
     plugins:
       - credit-matrix.mjs
   ```

## Use

Add this to a Markdown page:

````markdown
## Contributors

:::{credit-statement}
:::
````

Build with `jupyter-book build --html`. The statement appears in the book:

> **Marie Curie**: Software, Writing – original draft.

The [MyST guide](../myst/README.md) describes page author overrides, role aliases and limits.
This integration is for Jupyter Book 2, not the Sphinx-based Jupyter Book 1.
For a Sphinx project, use the [Sphinx directive](../sphinx/README.md).

[`example/`](example) is a complete book. Its config points at the shared MyST plugin.
CI builds both the MyST and Jupyter Book entry points and checks the rendered statement.
