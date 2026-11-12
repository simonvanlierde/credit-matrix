# CRediT statement for MyST

A [MyST](https://mystmd.org) plugin that adds a `{credit-statement}` directive. It writes a CRediT
authorship statement from the `roles` of your authors. MyST reads CRediT roles in the
[author front matter](https://mystmd.org/guide/frontmatter#frontmatter-authors) but doesn't print a
statement.

## Install

List the plugin by URL in `myst.yml`. It is one self-contained file.

```yaml
project:
  plugins:
    - https://unpkg.com/credit-matrix@0.13.0/dist/myst-plugin.mjs
```

MyST caches it in its build folder. The version in the URL is the package version: change that
number to upgrade. The plugin file is about 1.5 MB. The heatmap directive downloads a figure font
from jsDelivr the first time a figure needs it (0.6 MB for Latin text, 6-15 MB for a Japanese or
Chinese face) and keeps it in the machine's font cache. See
[fonts and offline use](../../docs/cli.md#fonts-and-offline-use).

To work offline or pin the file in your repository, copy
[`credit-matrix.mjs`](credit-matrix.mjs) into your project, run
`pnpm add credit-matrix credit-matrix-fonts yaml` next to it, and list `credit-matrix.mjs` under
`plugins` instead.

Tested with mystmd 1.12 and [Jupyter Book 2.1](../jupyter-book/README.md).

## Use

In the app, choose **MyST YAML** under Export data to copy or download the author block.
The CLI equivalent is `credit-matrix convert team.json --to myst`. Indent the block under `project`
in `myst.yml`, or paste it into a page's front matter. The exported roles have no contribution levels.

<!-- live: myst -->

```yaml
project:
  authors:
    - name: Marie Curie
      roles: [Conceptualization, Software, writing]
    - name: Albert Einstein
      roles: [Investigation, Formal analysis, editing]
```

```markdown
## CRediT authorship contribution statement

:::{credit-statement}
:::
```

renders as:

> **Marie Curie**: Conceptualization, Software, Writing – original draft; **Albert Einstein**: Formal
> analysis, Investigation, Writing – review & editing.

Authors in a page's own front matter replace the project's authors, as in MyST. Role names,
spellings and aliases follow MyST (`writing`, `editing`, `review`, `analysis`, `funding`, `admin`).
Roles that are not CRediT roles are left out, and the rest are listed in CRediT order.

[`example/`](example/) is a complete project: run `myst build --site` in it.

## Contribution levels

To add a footnote with an author's contribution levels, keep MyST's `roles` as strings.
Add the optional levels under `project.options.credit-matrix.levels` in `myst.yml`:

```yaml
project:
  authors:
    - id: marie
      name: Marie Curie
      roles: [Software, writing]
  options:
    credit-matrix:
      levels:
        marie:
          Software: equal
          writing: supporting
```

The statement keeps its role list and adds a footnote after the author’s roles:
“Software (Equal), Writing – original draft (Supporting).”
Levels use `lead`, `equal` or `supporting`; omitted roles default to lead.
An author with only lead roles gets no footnote. Footnote wording follows the document language.
A heatmap uses these levels when its `:levels:` option is true.

Each key identifies one author by `id` or exact display name. Use ids when names repeat.
Role names and aliases follow the native `roles` list. An unknown or unassigned role,
invalid level or ambiguous author stops the directive with an error.
This metadata belongs to this plugin; MyST's native roles and the app's MyST export stay unchanged.

A Markdown page can put `options.credit-matrix.levels` in its own front matter.
Page levels replace project levels. When a page replaces the project authors, it also drops
project levels unless it supplies its own. Notebook pages use the project settings.

## Document language

Set `project.lang` in `myst.yml`, for example `lang: fr-CA` or `lang: ja`.
A Markdown page's `lang` overrides the project language. Statements and heatmap labels come in
nine languages: English, French, German, Spanish, Italian, Portuguese (Portugal),
Dutch, Simplified Chinese and Japanese. A regional tag picks its language;
unsupported languages and Traditional Chinese fall back to English. Write your heading yourself.

## Contribution heatmap

[Figure options and examples](../heatmap.md) covers the `credit-heatmap` directive. From about
25 contributors it warns that the labels print under 6 pt, which fails a strict build. The
[final-size checks](../heatmap.md#final-size-readability-checks) say how to silence the warning.
For your own font, give the directive `:font: Inter` and `:font-path: fonts` (comma-separated
folders, relative to the folder of `myst.yml`), with `:ignore-system-fonts: true` and
`:font-fallback: sans|serif` as needed. MyST prints the file used as a message, and a missing
family is an error that names the page. A folder name cannot contain a comma.

The SVG assets embed fonts and keep editable text. For PDF and Word, see
[font portability and PDF export](../figures/README.md).

## Limitations

- MyST passes plugins no front matter, so the plugin reads `myst.yml` and the page's own Markdown
  front matter from disk. A notebook page uses the project's authors.
- An author listed only by `id` in a page is not looked up in the project's list.
- One format: by author. The [`credit-matrix`](../../src/core/README.md) package also writes by
  role and with initials.
