# CRediT statement for Jupyter Book 2

Jupyter Book 2 uses the MyST engine, so it runs our [MyST plugin](../myst/README.md) as is.

## Install

Add the plugin under `project` in `myst.yml`:

```yaml
version: 1
project:
  title: Example Lab handbook
  plugins:
    - https://unpkg.com/credit-matrix@0.13.0/dist/myst-plugin.mjs
```

## Use

Add authors under the same `project` key in `myst.yml`, or use your app's MyST YAML export.
Native MyST roles have no contribution levels; [optional levels](../myst/README.md#contribution-levels)
use separate metadata.

Indent the copied `authors:` block two spaces under the existing `project:` key.

<!-- live: myst -->

```yaml
project:
  authors:
    - name: Marie Curie
      roles: [Conceptualization, Software]
    - name: Albert Einstein
      roles: [Formal analysis, Investigation]
```

Add this to a Markdown page:

````markdown
## Contributors

:::{credit-statement}
:::
````

Build the book:

```sh
jupyter-book build --html
```

With the sample data, the statement reads:

> **Marie Curie**: Conceptualization, Software; **Albert Einstein**: Formal analysis, Investigation.

## Contribution heatmap

Add this beside the statement directive, then run `jupyter-book build --html` again:

```markdown
:::{credit-heatmap}
:::
```

The page now includes a heatmap from the same authors.
The heatmap's `:font:`, `:font-path:`, `:ignore-system-fonts:` and `:font-fallback:` options work
as in MyST ([your own font](../myst/README.md#contribution-heatmap)). The
[MyST guide](../myst/README.md) covers page author overrides, role aliases and limits.
Add optional [contribution levels](../myst/README.md#contribution-levels) to get a footnote
for each author with Equal or Supporting roles. These also work in notebook pages.

This is for Jupyter Book 2, not the Sphinx-based Jupyter Book 1.
For a Sphinx project, use the [Sphinx directive](../sphinx/README.md).

[`example/`](example/) is a complete book.

## Offline use

Copy [credit-matrix.mjs](../myst/credit-matrix.mjs) into your book.
Run `pnpm add credit-matrix credit-matrix-fonts yaml` beside it.
List `credit-matrix.mjs` under `plugins` instead of the URL.
The [MyST guide](../myst/README.md#offline-use-and-updates) covers caching, font downloads and updates.
