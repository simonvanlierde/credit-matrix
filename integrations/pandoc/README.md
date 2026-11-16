# CRediT statement for Pandoc

A Pandoc Lua filter that turns the author roles in a Markdown document's YAML front matter into a
CRediT statement. You don't need Quarto.

## Install

Copy [credit-matrix.lua](../quarto/_extensions/credit-matrix/credit-matrix.lua) next to your manuscript.
Pandoc and Quarto share this file.

## Use

Add authors and roles to the front matter of `paper.md`. Use the example below, or copy the
app's Quarto YAML export. Contribution levels are kept; a yes/no export omits them.

<!-- live: pandoc -->

```yaml
---
title: My paper
author:
  - name: Marie Curie
    roles:
      - conceptualization
      - software: supporting
  - name: Albert Einstein
    roles:
      - formal-analysis: equal
      - investigation
---
```

```sh
pandoc paper.md --lua-filter=credit-matrix.lua -o paper.html
```

With the sample data, the filter adds this statement at the end of the document:

> **Marie Curie**: Conceptualization, Software (Supporting);
> **Albert Einstein**: Formal analysis (Equal), Investigation.

It works with Pandoc's other writers too, including Word and LaTeX.

In R Markdown, pass it to the output format:

```yaml
output:
  html_document:
    pandoc_args: ["--lua-filter=credit-matrix.lua"]
```

Pandoc's default template prints an author with roles as "true" (HTML, LaTeX/PDF, ConTeXt, ms and
Word), so the filter turns each author into a plain name there. Templates that read
`author.name`, such as R Markdown's, and JATS keep the full author data. This needs Pandoc 3;
older versions leave the authors as they are.

[`example.md`](example.md) is a complete manuscript to try.

## Metadata and placement

Use `author` or `authors`, with one author map or a list. Names can be strings, `{literal: ...}`,
or `{given: ..., family: ...}`. Roles can be a single string or a list of role names and maps
such as `software: supporting`. The filter accepts the canonical CRediT names, British spellings,
and the aliases `writing`, `editing`, `review`, `analysis`, `funding`, `admin` and `administration`.
Unknown roles are left out. Repeated roles are merged, keeping the strongest degree.

Set `credit-matrix.format` to `by-role` for a paragraph grouped by role, or `table` for
roles in rows and contributors in columns. The default is `by-author`.
Set `credit-matrix.levels: false` to hide contribution degrees in text and tables.
The [Quarto options](../quarto/README.md#options) describe table cells and ordering.

Set `credit-matrix.heading` to change the heading, and `credit-matrix.placement` to `start` to
put the statement before the body. An empty `::: {#credit-statement}` div places it there instead.
The heading takes the level of the document's first heading.

Set `lang` in the front matter to translate the role names, levels, separators and default heading.
The [Quarto guide](../quarto/README.md#document-language) lists the languages and fallbacks.

## Contribution heatmap

The figure needs Node 22.19 or later and the package CLI. Install it in your document project:

```sh
pnpm add -D credit-matrix
```

Add this to the same front matter, then build with the local CLI:

```yaml
credit-matrix:
  heatmap: true
```

```sh
CREDIT_MATRIX_COMMAND="node node_modules/credit-matrix/dist/cli.js" pandoc paper.md --lua-filter=credit-matrix.lua -o paper.html
```

The document now includes a contribution heatmap. If `credit-matrix` is on `PATH`, you can omit
`CREDIT_MATRIX_COMMAND`. Its value is a command line; no argument can contain a space.
[Figure options and examples](../heatmap.md) lists every rendering option.
For your own font, set `font` to the family name. Set `font-path` to its folder, or list of
folders, relative to the document. Merge these options into the same `credit-matrix` block. [Your own font](../heatmap.md#your-own-font) lists
the other font options:

```yaml
credit-matrix:
  heatmap: true
  font: Inter
  font-path: fonts
  ignore-system-fonts: true
```

A missing family stops the render. The CLI embeds fonts in the SVG; where they come from is in
[fonts and offline use](../../docs/cli.md#fonts-and-offline-use). For PDF and Word, see
[font portability and PDF export](../figures/README.md).

## Limits

- Names are written in full. For statements with initials, use the
  [package CLI](../../src/core/README.md).
- Roles must be in the front matter. The filter doesn't infer them from prose.
- It credits authors only and doesn't create an acknowledgements section.
