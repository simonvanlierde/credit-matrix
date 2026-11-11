# CRediT statement for MyST

A [MyST](https://mystmd.org) plugin that adds a `{credit-statement}` directive. It writes a CRediT
authorship statement from the `roles` of your authors. MyST already reads CRediT roles in the
[author front matter](https://mystmd.org/guide/frontmatter#frontmatter-authors) but prints no
statement.

## Install

List the plugin by URL in `myst.yml`. It is one self-contained file: nothing else to install.

```yaml
project:
  plugins:
    - https://unpkg.com/credit-matrix@0.12.0/dist/myst-plugin.mjs
```

MyST caches it in its build folder. The version in the URL is the package version, so
upgrading is a change of that number.
The plugin file is about 1.5 MB. The heatmap directive downloads a figure font from jsDelivr the
first time a figure needs it: 0.6 MB for Latin text, 6-15 MB for a Japanese or Chinese face. It
keeps each face in the machine's font cache, so later builds work offline; the
[CLI section](../../src/core/README.md#cli) of the package README gives the folder.

To work offline or pin the file in your repository, copy
[`credit-matrix.mjs`](credit-matrix.mjs) into your project, run `pnpm add credit-matrix credit-matrix-fonts yaml`
next to it, and list `credit-matrix.mjs` under `plugins` instead.

Tested with mystmd 1.12 and [Jupyter Book 2.1](../jupyter-book/README.md).

## Use

In the app, choose **MyST YAML** under Export data to copy or download the author block.
The CLI equivalent is `credit-matrix convert team.json --to myst`. Indent the block under `project`
in `myst.yml`, or paste it into a page's front matter. MyST roles have no contribution levels.

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

Authors in a page's own front matter replace the project's authors, as they do in MyST. Role
names, spellings and aliases follow MyST (`writing`, `editing`, `review`, `analysis`, `funding`,
`admin`). Roles that are not CRediT roles are left out. Roles are listed in the CRediT order.

[`example/`](example) is a complete project: run `myst build --site` in it.

## Document language

Set `project.lang` in `myst.yml`, for example `lang: fr-CA` or `lang: ja`.
A Markdown page's `lang` overrides the project language. Statements and heatmap labels use
the app's nine language catalogs: English, French, German, Spanish, Italian, Portuguese (Portugal),
Dutch, Simplified Chinese and Japanese. Regional tags select the available language;
unsupported languages and Traditional Chinese fall back to English. Write your heading yourself.

## Contribution heatmap

See [figure options and examples](../heatmap.md) for the `credit-heatmap` directive.
Generated SVG assets contain embedded fonts and editable text. See
[font portability and PDF export](../figures/README.md) for document-converter limits.

## Limitations

- MyST passes plugins no front matter, so the plugin reads `myst.yml` and the page's own Markdown
  front matter from disk. A notebook page uses the project's authors.
- An author listed only by `id` in a page is not looked up in the project's list.
- MyST roles have no degree of contribution, so the statement shows no Equal or Supporting.
- One format: by author. The
  [`credit-matrix`](../../src/core/README.md) package also writes by role and with initials.
  The plugin uses the package for role names and statement wording.
