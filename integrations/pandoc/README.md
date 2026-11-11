# CRediT statement for Pandoc

Turn the author roles in a Markdown document's YAML front matter into a CRediT statement.
The filter works with Pandoc directly; Quarto is optional.

## Install

Copy [credit-matrix.lua](../quarto/_extensions/credit-matrix/credit-matrix.lua) beside your manuscript.
Pandoc and Quarto share this file, so there is one Lua renderer to maintain.

## Use

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

The statement is added at the end of the document:

> **Marie Curie**: Conceptualization, Software (Supporting), Writing – original draft;
> **Albert Einstein**: Formal analysis, Investigation.

The filter also works with Pandoc's other writers, including Word and LaTeX.

In R Markdown, pass it to the output format:

```yaml
output:
  html_document:
    pandoc_args: ["--lua-filter=credit-matrix.lua"]
```

Where Pandoc's default template would print an author with roles as "true" (HTML, LaTeX/PDF,
ConTeXt, ms and Word), the filter turns each author into a plain name. Templates that read
`author.name`, such as R Markdown's, and JATS keep the full author data. This needs Pandoc 3;
older versions leave the authors as they are.

[`example.md`](example.md) is a complete manuscript to try.

## Metadata and placement

Use `author` or `authors`, with one author map or a list. Names can be strings, `{literal: ...}`,
or `{given: ..., family: ...}`. Roles can be a single string or a list of role names and maps
such as `software: supporting`. The filter accepts the canonical CRediT names, British spellings,
and the aliases `writing`, `editing`, `review`, `analysis`, `funding`, `admin` and `administration`.
Unknown roles are left out. Repeated roles are merged, keeping the strongest degree.

Set `credit-matrix.heading` to change the heading and `credit-matrix.placement` to `start` to
put it before the body. An empty `::: {#credit-statement}` div places it at that point instead.
The heading takes the level of the document's first heading.

Set `lang` in the front matter to translate the role names, levels, separators and default heading.
The [Quarto guide](../quarto/README.md#document-language) lists supported languages and fallback rules.

## Contribution heatmap

Set `credit-matrix.heatmap: true` to add a figure through the package CLI. The filter runs
`credit-matrix` from `PATH`, or the command line in the `CREDIT_MATRIX_COMMAND` environment variable.
See [figure options and examples](../heatmap.md) for setup and all rendering options.
To draw the figure in your own font, set `credit-matrix.font` to a family name and
`credit-matrix.font-path` to a folder or list of folders, relative to the document, that hold it
(`font-fallback` and `ignore-system-fonts: true` work as in the [options table](../heatmap.md#your-own-font)):

```yaml
credit-matrix:
  heatmap: true
  font: Inter
  font-path: fonts
  ignore-system-fonts: true
```

A missing family stops the render, and the CLI's message goes to standard error.
The CLI embeds fonts in the generated SVG. They come from `credit-matrix-fonts` when it is
installed, otherwise from a one-time download ([details](../../src/core/README.md#cli)). See
[font portability and PDF export](../figures/README.md) for PDF and Word converter limits.

## Limits

- By author, with contribution levels. For other formats, use the
  [package CLI](../../src/core/README.md).
- Roles must be in the front matter; the filter does not infer them from prose.
- This filter credits authors. It does not create a separate acknowledgements section.
