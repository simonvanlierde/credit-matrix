# CRediT statement for Pandoc

A Pandoc Lua filter that turns the author roles in a Markdown document's YAML front matter into a
CRediT statement. You don't need Quarto.

## Install

Copy [credit-matrix.lua](../quarto/_extensions/credit-matrix/credit-matrix.lua) next to your manuscript.
Pandoc and Quarto share this file.

## Use

<!-- live: pandoc -->

```yaml
---
title: My paper
author:
  - name: Marie Curie
    roles:
      - conceptualization
      - software: supporting
      - writing
  - name: Albert Einstein
    roles: [investigation, analysis]
---
```

```sh
pandoc paper.md --lua-filter=credit-matrix.lua -o paper.html
```

The filter adds the statement at the end of the document:

> **Marie Curie**: Conceptualization, Software (Supporting), Writing – original draft;
> **Albert Einstein**: Formal analysis, Investigation.

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

Set `credit-matrix.heading` to change the heading, and `credit-matrix.placement` to `start` to
put the statement before the body. An empty `::: {#credit-statement}` div places it there instead.
The heading takes the level of the document's first heading.

Set `lang` in the front matter to translate the role names, levels, separators and default heading.
The [Quarto guide](../quarto/README.md#document-language) lists the languages and fallbacks.

## Contribution heatmap

Set `credit-matrix.heatmap: true` to add a figure through the package CLI. The filter runs
`credit-matrix` from `PATH`, or the command line in the `CREDIT_MATRIX_COMMAND` environment variable.
[Figure options and examples](../heatmap.md) lists every rendering option.
To use your own font, set `font` to the family name and `font-path` to the folder, or list of
folders, that holds it, relative to the document. [Your own font](../heatmap.md#your-own-font) lists
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

- By author, with contribution levels. For other formats, use the
  [package CLI](../../src/core/README.md).
- Roles must be in the front matter. The filter doesn't infer them from prose.
- It credits authors only and doesn't create an acknowledgements section.
