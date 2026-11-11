# CRediT statement for Jupyter Book 2

Jupyter Book 2 uses the MyST document engine. It runs our [MyST plugin](../myst/README.md)
directly; there is no second plugin to copy or configure.

## Install

Add the plugin by URL to `myst.yml`. It is one self-contained file: nothing else to install.

```yaml
version: 1
project:
  title: Example Lab handbook
  authors:
    - name: Marie Curie
      roles: [Software, writing]
  plugins:
    - https://unpkg.com/credit-matrix@0.12.0/dist/myst-plugin.mjs
```

To work offline, copy [credit-matrix.mjs](../myst/credit-matrix.mjs) into your book, run
`pnpm add credit-matrix credit-matrix-fonts yaml`, and list `credit-matrix.mjs` under `plugins` instead.

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
