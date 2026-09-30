# Core

Framework-agnostic TypeScript for CRediT Matrix. It models contributors, validates
contribution data, and produces [CRediT (Contributor Roles Taxonomy)](https://credit.niso.org/)
statements and exports.

The package has one runtime dependency, `zod`, and no React or Node APIs at import time. The web app
uses it directly in the browser.

## Domain model

An **`Author`** has identity fields (`id`, `name`, parsed name parts, deduplicated `initials`, and an
optional `orcid`), a `contributorType`, and a fixed array of 14 **`Contribution`** entries, one per
CRediT role.

`contributorType` is either `author` or `non-author`. Statement generation can keep non-author
contributors on a separate `Acknowledgements:` line; JATS4R export uses the value for `contrib-type`.

A contribution stores a **0–100 integer score**, not a boolean. The UI can collect that as a toggle,
picker, or slider without changing the data model. `scoreToLevel()` maps scores to CRediT's optional
degree-of-contribution terms:

| Score    | Level        |
| -------- | ------------ |
| `0`      | `none`       |
| `1–33`   | `supporting` |
| `34–66`  | `equal`      |
| `67–100` | `lead`       |

The 14 roles are defined once in `credit-roles.ts` with their NISO UUIDs, descriptions, and URLs. The
tuple also gives TypeScript the `CreditRoleName` union.

## Statements

`generateStatement(authors, options)` renders four formats:

- **`by-role`**: `CRediT: Conceptualization: Jane Smith, Bob White; Software: Jane Smith; …`
- **`by-role-short`**: same grouping as `by-role`, using initials
- **`by-author`**: `CRediT: Jane Smith: Conceptualization, Software; …`
- **`by-author-short`**: same grouping as `by-author`, using initials

Useful options:

- `showLevels`: annotate non-lead roles in by-author formats, for example `Software (Equal)`
- `translateRole`: localize role names while keeping canonical role keys internally
- `translateUi`: localize `Acknowledgements`, `Equal`, and `Supporting`
- `separateAcknowledgements`: keep non-author contributors on an `Acknowledgements:` line; defaults to
  `true`

Only non-zero contributions appear in statements.

## Import / export

| Format      | Out               | In                                  |
| ----------- | ----------------- | ----------------------------------- |
| JATS4R XML  | `toJats4rXml`     | `fromJats4rXml`                     |
| CSV         | `toCsv`           | `fromCsv`                           |
| JSON        | `toJson`          | `fromJson`                          |
| Markdown    | `toMarkdown`      | —                                   |
| Heatmap SVG | `buildHeatmapSvg` | —                                   |

`buildHeatmapSvg` returns a self-contained SVG string using system fonts and no embedded assets. The
web app uses that same SVG for preview, SVG download, and canvas-to-PNG export.

`fromJats4rXml(xml)` uses the global `DOMParser`: native in browsers, supplied by jsdom in tests.

## Validation

`AuthorSchema` and `ContributionSchema` validate imported or otherwise untrusted data. Scores must be
`0–100` integers, roles must be known CRediT names, and ORCID iDs are checked for shape and checksum.

## Testing

```sh
pnpm test
```

Vitest runs under jsdom. Tests cover name parsing, initials
deduplication, statement formats, score-to-level boundaries, import/export round trips, validation,
and heatmap SVG generation.
