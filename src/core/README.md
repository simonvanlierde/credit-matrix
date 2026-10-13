# credit-matrix

The TypeScript at the heart of CRediT Matrix, with no tie to React or Next.js. It models
contributors, validates contribution data, and produces
[CRediT (Contributor Roles Taxonomy)](https://credit.niso.org/) statements and exports. The
[CRediT Matrix](https://credit.duinlab.nl) web app runs this code in the browser. It is published
as an ESM package with types, and its one runtime dependency is `zod`.

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

`contributorType` is either `author` or `non-author`. A statement can put non-author contributors
on a separate `Acknowledgements:` line. The JATS4R export writes the value as `contrib-type`.

A contribution stores a **0–100 integer score**, not a yes/no value. The UI can collect it with a
toggle, a picker, or a slider without changing the data model. `scoreToLevel()` maps scores to
CRediT's optional levels of contribution:

| Score    | Level        |
| -------- | ------------ |
| `0`      | `none`       |
| `1–33`   | `supporting` |
| `34–66`  | `equal`      |
| `67–100` | `lead`       |

The 14 roles are defined once, in `credit-roles.ts`, with their NISO UUIDs, descriptions, and URLs.
TypeScript derives the `CreditRoleName` union from that same tuple.

## Statements

`generateStatement(authors, options)` renders four formats:

- **`by-role`**: `CRediT: Conceptualization: Jane Smith, Bob White; Software: Jane Smith; …`
- **`by-role-short`**: same grouping as `by-role`, using initials
- **`by-author`**: `CRediT: Jane Smith: Conceptualization, Software; …`
- **`by-author-short`**: same grouping as `by-author`, using initials

The options you'll most likely want:

- `showLevels`: mark non-lead contributions with their level, after the role in by-author formats
  (for example `Software (Equal)`) and after the name in by-role formats
- `translateRole`: translate role names; the official English role names stay the keys inside
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
| tenzing CSV | —                 | `fromTenzing`                       |
| Heatmap SVG | `buildHeatmapSvg` | —                                   |

`buildHeatmapSvg` returns an SVG string that needs nothing else: it uses system fonts and embeds no
assets. The web app uses that same SVG for the preview, the SVG download, and the PNG export (drawn
onto a canvas).

`fromJats4rXml(xml, { parser })` reads XML with `parser`, which defaults to the global `DOMParser`.
In Node, pass one, such as [linkedom](https://github.com/WebReflection/linkedom)'s:

```ts
import { DOMParser } from "linkedom";
fromJats4rXml(xml, { parser: new DOMParser() });
```

`detectFormat(text)` guesses the format from the text's shape, and `importAny(text, { parser })`
reads any of them, share links and [tenzing](https://github.com/marton-balazs-kovacs/tenzing)
spreadsheets (CSV or TSV) included. It returns the `format` it read, plus `asks`, `selfId` and
`title` when the format carries them.

`toJson(authors, { asks, includeAnswers, selfId })` also writes the asks and co-author answers
(unless `includeAnswers` is `false`), and `selfId`, the contributor who made the file. Both are
optional, so older files still load. `fromJson` returns `{ authors, asks?, selfId? }`. It throws a
`NewerVersionError` for a file whose `version` is higher than the one this build writes
(`JSON_EXPORT_VERSION` in `export/json.ts`). It throws a `ZodError` for any other data that does
not match.

## Asks and review

`ask.ts` models asking a co-author for their row and settling their answer. An **`Ask`** records when
the link was sent, whether it carried your guess (`prefilled`), and the latest `reply`. A reply keeps
the co-author's roles and markers beside the row. Once you choose, it also holds a `Decision` per
target. A target is one of the 14 roles or one of the two markers (`equalContribution`,
`corresponding`). `ASK_TARGETS` lists them in order.

- `askStep(state, event)`: every change to asks and replies (`sent`, `reply`, `settle`). It has no
  side effects: the time comes in on the event, and it never throws on the row in a reply, which it
  can't trust. Returns an `outcome`, a `patch`, and the `undo` patch.
- `applyPatch(state, patch)`: applies a patch to `{ authors, asks }`. It skips rows that are gone, so
  a late undo never brings back an ask for a removed row.
- `review(author, ask)`: the ask's status (`none`, `asked`, `differs`, `settled`), every difference
  by target, and the ones still `open`. The result is cached per pair of objects, so replace state
  and never change it in place.
- `settledAt(reply)`: when an answer was settled. That is its last decision, or when it arrived if
  nothing needed a decision.
- `importAnswers(current, incoming, mapped, held, { asks, selfId })`: moves a JSON file's answers
  and `selfId` over to the ids that `keepKnownIds` gave the imported rows. When you import into a
  draft that already has contributors, only rows that matched one of them keep their answers.
- `levelOf(answer, target)` and `isMarker(target)`: compare levels, never raw scores.
- `AskSchema` validates stored and imported asks.

## Rosters and links

`createAuthor(name, fields)` builds one contributor and `parseAuthorText(text)` a list from pasted
names. `normalizeRoster(authors)` applies the rules every caller shares: at most 200 contributors,
ids unique and short enough for a link, and initials made unique.

`encodeShareHash(input, baseUrl)` writes a draft, or one contributor's row for an ask, into a
compressed `#s=…` link, and `decodeShareHash(hash)` reads one back (or returns `null`).

## Exports

The public API is what the entry points export. The
[type snapshot](https://github.com/simonvanlierde/credit-matrix/blob/main/src/core/__tests__/__snapshots__/public-api.d.ts.snap)
holds its exact shape. By entry point:

- `credit-matrix`
  - Model: `Author`, `Contribution`, `ContributionLevel`, `ContributorType`, `AuthorSchema`,
    `ContributionSchema`, `scoreToLevel`, `isValidOrcid`, `normalizeOrcid`
  - Roles: `CREDIT_ROLES`, `getRoleByName`, `CreditRoleName`
  - Rosters: `createAuthor`, `parseAuthorText`, `normalizeRoster`
  - Statements: `generateStatement`, `StatementFormat`, `StatementOptions`
  - Formats: `toJson`, `fromJson`, `NewerVersionError`, `toCsv`, `fromCsv`, `toJats4rXml`,
    `fromJats4rXml`, `XmlParser`, `XmlElement`, `fromTenzing`, `isTenzing`, `toMarkdown`,
    `buildHeatmapSvg`, `HeatmapSvgOptions`, `detectFormat`, `importAny`, `DetectedFormat`, `Imported`
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

The palette, the limits and the merge helpers are internal. The web app imports them by path.

## Validation

`AuthorSchema` and `ContributionSchema` validate imported data and any other data the app can't
trust. Scores must be `0–100` integers, and roles must be known CRediT names. ORCID iDs are checked
for shape and checksum.

## Testing

```sh
pnpm test                          # from the repository root
pnpm --filter credit-matrix build  # dist/, as published
```

The core tests run under Node, not in a browser environment, so a browser global used by mistake
fails here first. linkedom stands in for `DOMParser`. The element test opts into jsdom. The package
is built before the tests run. One test imports it through its `exports` map, checks the list of
exports, compares the declarations with the committed type snapshot, and runs the built CLI. If you
change the public interface on purpose, update the snapshots with
`pnpm exec vitest run --project core -u`.
