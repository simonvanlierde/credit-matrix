# CRediT statement for Quarto

A Quarto filter that turns the author `roles` in your front matter into a CRediT authorship
contribution statement. Quarto reads CRediT roles (see
[Authors & Affiliations](https://quarto.org/docs/journals/authors.html)) but doesn't print a statement.

## Install

From the root of your Quarto project:

```bash
quarto add simonvanlierde/credit-matrix/integrations/quarto
```

Or copy `_extensions/credit-matrix/` from this folder into your project's `_extensions/` folder.

Needs Quarto 1.4 or later. Tested with Quarto 1.10.
For plain Pandoc, use the same Lua file as in the [Pandoc guide](../pandoc/README.md).

## Use

In the app, choose **Quarto YAML** under Export data to copy or download the author block.
The CLI equivalent is `credit-matrix convert team.json --to quarto`. Paste the block into your
manuscript's front matter, next to `filters`. It keeps contribution levels; `--yes-no` omits them.

<!-- live: quarto -->

```yaml
---
title: My paper
author:
  - name: Marie Curie
    roles:
      - conceptualization: lead
      - software: supporting
      - writing
  - name: Albert Einstein
    roles: [investigation, formal analysis]
filters:
  - credit-matrix
---
```

The filter adds this at the end of the body:

> **CRediT authorship contribution statement**
>
> **Marie Curie**: Conceptualization, Software (Supporting), Writing – original draft;
> **Albert Einstein**: Formal analysis, Investigation.

Roles use Quarto's names and aliases (`writing`, `editing`, `analysis`, `funding`). An `equal` or
`supporting` degree shows after the role; `lead` or no degree shows nothing. Roles that are not
CRediT roles are left out, and the rest are listed in CRediT order. The heading is unnumbered and
takes the level of the first heading in the document. References still come after it.

[`example.qmd`](example.qmd) is a complete document.

## Document language

Set `lang` in the document's front matter, for example `lang: fr-CA` or `lang: ja`.
Role names, contribution levels, separators and the default heading follow that language, and so
do the heatmap labels. `credit-matrix.locale` overrides the figure language.
The filter has nine languages: English, French, German, Spanish, Italian,
Portuguese (Portugal), Dutch, Simplified Chinese and Japanese. A regional tag picks its language;
unsupported languages and Traditional Chinese fall back to English.
Your own `credit-matrix.heading` still wins.

## Options

```yaml
credit-matrix:
  heading: Author contributions   # default: CRediT authorship contribution statement
  placement: start                # end (default) or start of the body
  format: by-role                 # by-author (default), by-role or table
  levels: false                   # true (default) shows equal/supporting degrees
```

`by-role` lists the contributors under each role, in author order. `table` puts active roles
in rows and contributors in columns. Both use canonical CRediT role order.
The table shows translated contribution levels in assigned cells. With `levels: false`,
every assigned cell shows “Contributed” in the document's language. Empty cells mean no
contribution. Contributors without a CRediT role are left out.

To put the statement somewhere else, leave an empty div where it should go:

```markdown
::: {#credit-statement}
:::
```

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

## Limitations

- Names are written in full. For statements with initials, use the app or package CLI.
- Non-author contributors (acknowledgements) aren't handled: Quarto has no field for them.
