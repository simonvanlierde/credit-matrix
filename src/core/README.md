# Core

The TypeScript at the heart of CRediT Matrix, with no tie to React or Next.js. It models
contributors, validates contribution data, and produces
[CRediT (Contributor Roles Taxonomy)](https://credit.niso.org/) statements and exports.

It has one runtime dependency, `zod`, and uses no React or Node APIs when it's imported. The web
app imports it directly and runs it in the browser.

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
| Heatmap SVG | `buildHeatmapSvg` | —                                   |

`buildHeatmapSvg` returns an SVG string that needs nothing else: it uses system fonts and embeds no
assets. The web app uses that same SVG for the preview, the SVG download, and the PNG export (drawn
onto a canvas).

`fromJats4rXml(xml)` uses the global `DOMParser`: native in browsers, supplied by jsdom in tests.

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

## Exports

`index.ts` is the public API. By module:

- `ask`: `ASK_TARGETS`, `AskSchema`, `applyPatch`, `askStep`, `importAnswers`, `isMarker`,
  `levelOf`, `review`, `settledAt`, and the types `Ask`, `AskEvent`, `AskState`, `Choice`,
  `Decision`, `Difference`, `Level`, `Outcome`, `Patch`, `Reply`, `Review`, `Target`
- `author`: `Author`, `Contribution`, `AuthorSchema`, `ContributionSchema`, `clampScore`,
  `hasContributions`, `isAllBinary`, `isUsableAuthorName`, `isValidOrcid`, `normalizeOrcid`,
  `ORCID_REGEX`, `rolesWithContributions`, `scoreToLevel`, `LEVEL_SCORE`, `MAX_AUTHOR_NAME_LENGTH`, `MAX_AUTHORS`,
  `MAX_IMPORT_BYTES`
- `contributor-color`: `DEFAULT_MONO_COLOR`, `heatCellColor`, `OKABE_ITO`, `onColor`
- `credit-i18n`: `AVAILABLE_LOCALES`, `DEFAULT_ROLE_TRANSLATOR`, `hasCatalog`, `loadRoleCatalog`,
  `makeRoleDescriber`, `makeRoleTranslator`, `normalizeLocaleCode`, `DEFAULT_UI_TRANSLATOR`,
  `loadUiCatalog`, `makeUiTranslator`, and the types `LocaleCode`, `RoleDescriber`,
  `RoleTranslator`, `UiKey`, `UiTranslator`
- `credit-roles`: `CREDIT_ROLES`, `getRoleByName`, `CreditRoleName`
- Lookups: `lookupDoiWork`, `normalizeDoi`, `DOI_INPUT_REGEX`, `DoiLookupResult`,
  `lookupOrcidPerson`, `OrcidLookupResult`
- Import and export: `toCsv`, `fromCsv`, `toJson`, `fromJson`, `NewerVersionError`, `toMarkdown`,
  `toJats4rXml`, `fromJats4rXml`, `buildHeatmapSvg`
- Statements: `generateStatement`, `StatementFormat`
- Rows: `createAuthor`, `deduplicateAuthorInitials`, `parseAuthorText`, `splitNameList`,
  `keepKnownIds`
- Share links: `toSharePayload`, `fromSharePayload`, `ShareData`, `SharePayloadInput`
- `validateContributions`

## Validation

`AuthorSchema` and `ContributionSchema` validate imported data and any other data the app can't
trust. Scores must be `0–100` integers, and roles must be known CRediT names. ORCID iDs are checked
for shape and checksum.

## Testing

```sh
pnpm test
```

One Vitest run, under jsdom, covers the core, the store, and `src/lib`. The core tests cover name
parsing, removing duplicate initials, statement formats, which score maps to which level, exporting
and importing back, validation, and the heatmap SVG.
