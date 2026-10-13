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

## Use

```yaml
---
title: My paper
author:
  - name: Jane A. Smith
    roles:
      - conceptualization: lead
      - software: supporting
      - writing
  - name: Bob White
    roles: [investigation, formal analysis]
filters:
  - credit-matrix
---
```

This adds, at the end of the body:

> **CRediT authorship contribution statement**
>
> **Jane A. Smith**: Conceptualization, Software (Supporting), Writing – original draft;
> **Bob White**: Formal analysis, Investigation.

Roles use Quarto's names and aliases (`writing`, `editing`, `analysis`, `funding`). An `equal` or
`supporting` degree is shown after the role; `lead` or no degree shows nothing. Roles that are not
CRediT roles are left out. Roles are listed in the CRediT order. The heading takes the level of
the first heading in the document and is unnumbered. References still come after it.

[`example.qmd`](example.qmd) is a complete document.

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

## Limitations

- English role names only. The [app](https://github.com/simonvanlierde/credit-matrix) and the
  `credit-matrix` package also write the statement in eight other languages.
- One format: by author, with levels. The app also writes by role and with initials.
- Contributors who are not authors (acknowledgements) are not handled: Quarto has no field for
  them.
