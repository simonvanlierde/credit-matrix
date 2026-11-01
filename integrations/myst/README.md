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
    - https://unpkg.com/credit-matrix@0.10.0/dist/myst-plugin.mjs
```

MyST caches it in its build folder. The version in the URL is the package version, so
upgrading is a change of that number.

To work offline or pin the file in your repository, copy
[`credit-matrix.mjs`](credit-matrix.mjs) into your project, run `pnpm add credit-matrix yaml`
next to it, and list `credit-matrix.mjs` under `plugins` instead.

Tested with mystmd 1.12 and [Jupyter Book 2.1](../jupyter-book/README.md).

## Use

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

## Limitations

- MyST passes plugins no front matter, so the plugin reads `myst.yml` and the page's own Markdown
  front matter from disk. A notebook page uses the project's authors.
- An author listed only by `id` in a page is not looked up in the project's list.
- MyST roles have no degree of contribution, so the statement shows no Equal or Supporting.
- English only. The plugin ignores the document's `lang`: role names, separators and the
  statement are always English, and you write any heading yourself. For another language, run
  `credit-matrix statement file.json --locale fr` from the package CLI and paste the result.
- One format: by author. The
  [`credit-matrix`](../../src/core/README.md) package also writes by role, with initials and in
  eight other languages. The plugin uses the package for role names and statement wording.
