# CRediT statement for Quarto

A Quarto filter that turns the author `roles` in your front matter into a CRediT authorship
contribution statement. Quarto already reads CRediT roles (see
[Authors & Affiliations](https://quarto.org/docs/journals/authors.html)) but prints no statement.

## Install

From the root of your Quarto project:

```bash
quarto add simonvanlierde/credit-matrix/integrations/quarto
```

`quarto add` accepts `owner/repo/subdirectory` and installs the `_extensions` folder it finds
there. Or copy `_extensions/credit-matrix/` from this folder into your project's `_extensions/`
folder by hand.

Needs Quarto 1.4 or later. Tested with Quarto 1.10.
For plain Pandoc, use the same Lua file as described in the [Pandoc guide](../pandoc/README.md).

## Use

In the app, choose **Quarto YAML** under Export data to copy or download the author block.
The CLI equivalent is `credit-matrix convert team.json --to quarto`. Paste the block into your
manuscript's front matter, alongside `filters`. It keeps contribution levels; `--yes-no` omits them.

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

This adds, at the end of the body:

> **CRediT authorship contribution statement**
>
> **Marie Curie**: Conceptualization, Software (Supporting), Writing – original draft;
> **Albert Einstein**: Formal analysis, Investigation.

Roles use Quarto's names and aliases (`writing`, `editing`, `analysis`, `funding`). An `equal` or
`supporting` degree is shown after the role; `lead` or no degree shows nothing. Roles that are not
CRediT roles are left out. Roles are listed in the CRediT order. The heading takes the level of
the first heading in the document and is unnumbered. References still come after it.

[`example.qmd`](example.qmd) is a complete document.

## Document language

Set `lang` in the document's front matter, for example `lang: fr-CA` or `lang: ja`.
Role names, contribution levels, separators and the default heading follow that language.
The filter uses the app's nine language catalogs: English, French, German, Spanish, Italian,
Portuguese (Portugal), Dutch, Simplified Chinese and Japanese. Regional tags select the available
language; unsupported languages and Traditional Chinese fall back to English.
Your own `credit-matrix.heading` still wins. Heatmap labels follow the document language too;
`credit-matrix.locale` overrides the figure language.

## Options

```yaml
credit-matrix:
  heading: Author contributions   # default: CRediT authorship contribution statement
  placement: start                # end (default) or start of the body
```

To put the statement somewhere else, leave an empty div where it should go:

```markdown
::: {#credit-statement}
:::
```

## Contribution heatmap

Set `credit-matrix.heatmap: true` to add a figure through the package CLI.
See [figure options and examples](../heatmap.md) for setup and all rendering options.
The CLI embeds fonts in the generated SVG. See
[font portability and PDF export](../figures/README.md) for PDF and Word converter limits.

## Limitations

- One format: by author, with levels. The app also writes by role and with initials.
- Contributors who are not authors (acknowledgements) are not handled: Quarto has no field for
  them.
