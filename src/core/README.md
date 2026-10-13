# credit-matrix

Model, check and export [CRediT (Contributor Roles Taxonomy)](https://credit.niso.org/) contribution
statements. This is the code behind the [CRediT Matrix](https://credit.duinlab.nl) web app, published as
an ESM package with types. Its one runtime dependency is `zod`.

```bash
npm install credit-matrix
```

```ts
import { generateStatement, importAny, toJats4rXml } from "credit-matrix";

const { authors } = await importAny(csvText); // JSON, CSV, JATS4R XML, a share link or names
generateStatement(authors, { format: "by-role" }); // "CRediT: Conceptualization: Jane Smith; …"
toJats4rXml(authors);
```

## Entry points

| Import | Contents | Needs |
| --- | --- | --- |
| `credit-matrix` | the model and roles, statements, every format, heatmap SVG, links, asks | nothing (in Node, JATS import takes a parser) |
| `credit-matrix/lookup` | ORCID and DOI lookups | `fetch` |
| `credit-matrix/i18n` | role names and output strings in nine languages | nothing |
| `credit-matrix/element` | registers the `<credit-matrix>` element ([docs](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/element.md)) | a DOM |
| `credit-matrix` (bin) | the CLI, with an XML parser bundled | Node |

## CLI

```bash
npx credit-matrix statement team.csv --format by-author --locale fr
npx credit-matrix convert paper.xml --to json      # json, csv, jats or md
npx credit-matrix ask draft.json --contributor "Jane Smith" --blank
```

Each command reads a file, or `-` for standard input, in any format `importAny` reads. `ask` prints a
link that opens the contributor's own row in the web app (`--base-url` points it at another copy).
The link they send back can be read with `convert`.

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

`fromJats4rXml(xml, { parser })` reads XML with `parser`, which defaults to the global `DOMParser`.
In Node, pass one, such as [linkedom](https://github.com/WebReflection/linkedom)'s:

```ts
import { DOMParser } from "linkedom";
fromJats4rXml(xml, { parser: new DOMParser() });
```

`detectFormat(text)` guesses the format from the text's shape, and `importAny(text, { parser })`
reads any of them, share links included. It returns the `format` it read, plus `asks`, `selfId` and
`title` when the format carries them.

`toJson(authors, { asks, includeAnswers, selfId })` also writes the asks and co-author answers
(unless `includeAnswers` is `false`) and `selfId`, the contributor who made the file. Both are
optional, so older files still load. `fromJson` returns `{ authors, asks?, selfId? }`. It throws a
`NewerVersionError` for a file whose `version` is above the one this build writes (`JSON_EXPORT_VERSION` in
`export/json.ts`), and a `ZodError` for
any other data that does not match.

## Asks and review

`ask.ts` models asking a co-author for their row and settling their answer. An **`Ask`** records when
the link was sent, whether it carried your guess (`prefilled`), and the latest `reply`. A reply keeps
the co-author's roles and markers beside the row, plus a `Decision` per target once you choose.
A target is one of the 14 roles or one of the two markers (`equalContribution`, `corresponding`);
`ASK_TARGETS` lists them in order.

- `askStep(state, event)`: every change to asks and replies (`sent`, `reply`, `settle`). Pure: time
  comes in on the event, and it never throws on a reply's untrusted row. Returns an `outcome`, a
  `patch`, and the `undo` patch.
- `applyPatch(state, patch)`: applies a patch to `{ authors, asks }`. It skips rows that are gone, so
  a late undo never brings back an ask for a removed row.
- `review(author, ask)`: the ask's status (`none`, `asked`, `differs`, `settled`), every difference
  by target, and the ones still `open`. Cached per object pair, so replace state, never mutate it.
- `settledAt(reply)`: when an answer was settled: its last decision, or its arrival if nothing needed
  one.
- `importAnswers(current, incoming, mapped, held, { asks, selfId })`: carries a JSON file's answers
  and `selfId` over to the ids `keepKnownIds` gave the imported rows. Into a draft that has contributors, only rows
  that matched one keep them.
- `levelOf(answer, target)` and `isMarker(target)`: compare levels, never raw scores.
- `AskSchema` validates stored and imported asks.

## Rosters and links

`createAuthor(name, fields)` builds one contributor and `parseAuthorText(text)` a list from pasted
names. `normalizeRoster(authors)` applies the rules every caller shares: at most 200 contributors,
ids unique and short enough for a link, and initials made unique.

`encodeShareHash(input, baseUrl)` writes a draft, or one contributor's row for an ask, into a
compressed `#s=…` link, and `decodeShareHash(hash)` reads one back (or returns `null`).

## Exports

The [type snapshot](https://github.com/simonvanlierde/credit-matrix/blob/main/src/core/__tests__/__snapshots__/public-api.d.ts.snap) holds the exact public interface.

- `credit-matrix`
  - Model: `Author`, `Contribution`, `ContributionLevel`, `ContributorType`, `AuthorSchema`,
    `ContributionSchema`, `scoreToLevel`, `isValidOrcid`, `normalizeOrcid`
  - Roles: `CREDIT_ROLES`, `getRoleByName`, `CreditRoleName`
  - Rosters: `createAuthor`, `parseAuthorText`, `normalizeRoster`
  - Statements: `generateStatement`, `StatementFormat`, `StatementOptions`
  - Formats: `toJson`, `fromJson`, `NewerVersionError`, `toCsv`, `fromCsv`, `toJats4rXml`,
    `fromJats4rXml`, `XmlParser`, `XmlElement`, `toMarkdown`, `buildHeatmapSvg`, `HeatmapSvgOptions`,
    `detectFormat`, `importAny`, `DetectedFormat`, `Imported`
  - Links: `encodeShareHash`, `decodeShareHash`, `ShareData`, `SharePayloadInput`
  - Asks: `ASK_TARGETS`, `AskSchema`, `applyPatch`, `askStep`, `importAnswers`, `isMarker`,
    `levelOf`, `review`, `settledAt`, and the types `Ask`, `AskEvent`, `AskState`, `Choice`,
    `Decision`, `Difference`, `Level`, `Outcome`, `Patch`, `Reply`, `Review`, `Target`
- `credit-matrix/lookup`: `lookupOrcidPerson`, `lookupDoiWork`, `normalizeDoi`, `DOI_INPUT_REGEX`,
  and the types `OrcidLookupResult`, `OrcidErrorCode`, `DoiLookupResult`, `DoiErrorCode`, `DoiAuthor`
- `credit-matrix/i18n`: `AVAILABLE_LOCALES`, `normalizeLocaleCode`, `hasCatalog`,
  `loadRoleCatalog`, `makeRoleTranslator`, `makeRoleDescriber`, `DEFAULT_ROLE_TRANSLATOR`,
  `loadUiCatalog`, `makeUiTranslator`, `DEFAULT_UI_TRANSLATOR`, and the types `LocaleCode`,
  `RoleCatalog`, `RoleDescriber`, `RoleTranslator`, `UiCatalog`, `UiKey`, `UiTranslator`
- `credit-matrix/element`: `CreditMatrixElement`

The palette, limits and merge helpers the web app also uses are internal: the app imports them by
path.

## Validation

`AuthorSchema` and `ContributionSchema` validate imported or otherwise untrusted data. Scores must be
`0–100` integers, roles must be known CRediT names, and ORCID iDs are checked for shape and checksum.

## Testing

```sh
pnpm test                          # from the repository root
pnpm --filter credit-matrix build  # dist/, as published
```

The core tests run under Node, not a browser environment, so a stray browser global fails here first;
linkedom stands in for `DOMParser`. The element test opts into jsdom. Before they run, the package is
built, and one test imports it through its `exports` map, checks the export list, compares the
declarations with the committed type snapshot, and runs the built CLI. Update the snapshots with
`pnpm exec vitest run --project core -u` when the public interface changes on purpose.
