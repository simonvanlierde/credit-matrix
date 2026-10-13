# CRediT statement for MyST

A [MyST](https://mystmd.org) plugin that adds a `{credit-statement}` directive. It writes a CRediT
authorship statement from the `roles` of your authors. MyST already reads CRediT roles in the
[author front matter](https://mystmd.org/guide/frontmatter#frontmatter-authors) but prints no
statement.

## Install

1. Copy [`credit-matrix.mjs`](credit-matrix.mjs) into your project.
2. Install its one dependency, a YAML parser, next to it: `npm install yaml`.
3. List it in `myst.yml`:

   ```yaml
   project:
     plugins:
       - credit-matrix.mjs
   ```

Tested with mystmd 1.11.

## Use

```yaml
project:
  authors:
    - name: Jane A. Smith
      roles: [Conceptualization, Software, writing]
    - name: Bob White
      roles: [Investigation, Formal analysis, editing]
```

```markdown
## CRediT authorship contribution statement

:::{credit-statement}
:::
```

renders as:

> **Jane A. Smith**: Conceptualization, Software, Writing – original draft; **Bob White**: Formal
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
- English role names only, and one format: by author. The
  [`credit-matrix`](../../src/core/README.md) package also writes by role, with initials and in
  eight other languages. The plugin carries its own copy of the wording instead of importing the
  package, so it has a single dependency.
