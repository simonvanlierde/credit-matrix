# credit-matrix

[CRediT (Contributor Roles Taxonomy)](https://credit.niso.org/) statements and exports, as the
[CRediT Matrix](https://credit.duinlab.nl) web app runs them in the browser. It is an ESM package
with types, with no tie to React or Next.js, and its one runtime dependency is `zod`.

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

## CLI

The package also installs a `credit-matrix` command: the CLI, with an XML parser bundled. It needs
Node 20.12 or later. Run it with `npx credit-matrix` without installing, or with
`node src/core/dist/cli.js` from a clone after `pnpm --filter credit-matrix build`.

```bash
npx credit-matrix statement team.csv --format by-author --locale fr --levels
npx credit-matrix convert paper.xml --to json      # json, csv, jats or md
npx credit-matrix ask draft.json --contributor "Jane Smith" --blank
npx credit-matrix --help                           # or --version
```

Each command reads a file, or `-` for standard input, in any format `importAny` reads. Spreadsheet
files (.xlsx, .xls, .ods) are refused: save the sheet as CSV first. `statement --levels` adds Equal or
Supporting after each contribution below Lead. `statement` exits with 1 when nobody has a role yet.

`ask` prints a link that opens the contributor's own row in the web app (`--base-url` points it at
another copy). `--contributor` takes an id, a full name, or a first name or surname only one person
has; when nothing matches, the error lists the contributors. The link they send back can be read
with `convert`.

A mistake in the command line prints one line and exits with 2; any other error exits with 1.

## Domain model

An **`Author`** has identity fields (`id`, `name`, parsed name parts, deduplicated `initials`, and an
optional `orcid`), a `contributorType`, and a fixed array of 14 **`Contribution`** entries, one per
CRediT role.

Particles such as `van`, `de la` or `bin`, in any case, stay with the surname: "Anne van der Berg"
and "van der Berg, Anne" both have surname `van der Berg`. Initials skip them, so both are `AB`.

`contributorType` is either `author` or `non-author`. A statement can put non-author contributors
on a separate `Acknowledgements:` line. The JATS4R export writes the value as `contrib-type`.

A contribution stores a **0–100 integer score**, not a yes/no value. `scoreToLevel()` maps scores to
CRediT's optional levels of contribution:

| Score    | Level        |
| -------- | ------------ |
| `0`      | `none`       |
| `1–33`   | `supporting` |
| `34–66`  | `equal`      |
| `67–100` | `lead`       |

The 14 roles are defined once, in `credit-roles.ts`, with their NISO UUIDs, descriptions, and URLs,
and the `CreditRoleName` union derives from them.

`AuthorSchema` and `ContributionSchema` validate imported data and any other data the app can't
trust. Scores must be `0–100` integers, and roles must be known CRediT names. ORCID iDs are checked
for shape and checksum.

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
| tenzing CSV | `toTenzing`       | `fromTenzing`                       |
| Heatmap SVG | `buildHeatmapSvg` | —                                   |

`buildHeatmapSvg` returns an SVG string that needs nothing else: it uses system fonts and embeds no
assets.
Its `<desc>` is the by-author contribution statement, so a screen reader hears who did what;
`heatmapDescription` returns that text, for an image's alt text or a PNG's Description field.

`fromCsv` needs a `Name` column. Other headers and role names match whatever their case or kind of
dash. A score cell is a number from 0 to 100 or a level word (`None`, `Supporting`, `Equal`, `Lead`).
Rows without a usable name are skipped.

`toTenzing` writes the columns of tenzing's example CSV. tenzing records a role as done or not, so
any score above 0 becomes `TRUE`, and equal contribution is not kept. Rows run in byline order:
authors in draft order, then acknowledgees, numbered on from the authors. Affiliations, email,
funding and declarations are left empty for the team.

`fromJats4rXml(xml, { parser })` reads XML with `parser`, which defaults to the global `DOMParser`.
In Node, pass one, such as [linkedom](https://github.com/WebReflection/linkedom)'s:

```ts
import { DOMParser } from "linkedom";
fromJats4rXml(xml, { parser: new DOMParser() });
```

`detectFormat(text)` guesses the format from the text's shape, and `importAny(text, { parser })`
reads any of them, share links and [tenzing](https://github.com/marton-balazs-kovacs/tenzing)
spreadsheets (CSV or TSV) included. It returns the `format` it read, plus `asks`, `selfId` and
`title` when the format carries them. Text that assigns CRediT roles ("MG: conceptualization",
"Methodology, A.B.") or tells in sentences what the authors did is a `"statement"`, which
`importAny` refuses: a statement names roles, not contributors.

`parseStatement(text, authors)` reads a free-text CRediT statement against an author list of
`{ given, surname }` (`statementAuthor(author)` splits a contributor's name that way). It returns
`assignments`, each an author index and a role name, and `unresolved`: names or initials that fit
no author, or more than one, which it never guesses. `unmatched` lists each of those once, with
`candidates` (the author indices it could be, empty when none) and the `roles` left out for it.
It throws a `RangeError` on text longer than `MAX_STATEMENT_LENGTH` (50,000 characters); real
statements stay under 5,000. Only CRediT wording counts, so "A.B. conceived
the study" yields nothing. It does not judge whether the text is a CRediT statement at all:
`namesCredit(text)` says whether it uses a term prose rarely does (conceptualization, data curation,
original draft, ...). The parser is a port of the one in `census/`, which is scored there against
the roles publishers tag, and a test holds the two to the same output.

```ts
const authors = [createAuthor("Mark Green"), createAuthor("Eva Mills")];
const { assignments, unresolved } = parseStatement(
  "MG: conceptualization. EM: data curation. XY: software.",
  authors.map(statementAuthor),
); // [{ author: 0, role: "Conceptualization" }, { author: 1, role: "Data curation" }], ["XY"]
```

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

A reply can carry an ORCID sign-in. The caller checks it and passes it on the `reply` event as
`orcid`; the reply keeps it as `provenance.orcid` (an `OrcidProof`). What "verified" means is
defined in the module comment of `orcid-proof.ts`. When a signed reply changes the row's iD, the
reply also keeps the old one as `provenance.replacedOrcid`. Run `recheckSignIns(asks,
fetchOrcidKeys)` on the `asks` that `fromJson` or `importAny` returns before you show any sign-in
as verified.

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
  - Statements: `generateStatement`, `STATEMENT_FORMATS`, `StatementFormat`, `StatementOptions`
  - Formats: `toJson`, `fromJson`, `NewerVersionError`, `toCsv`, `fromCsv`, `toJats4rXml`,
    `fromJats4rXml`, `XmlParser`, `XmlElement`, `fromTenzing`, `isTenzing`, `toTenzing`,
    `toMarkdown`, `buildHeatmapSvg`, `heatmapDescription`, `HeatmapSvgOptions`, `detectFormat`,
    `importAny`, `DetectedFormat`, `Imported`
  - Pasted statements: `parseStatement`, `statementAuthor`, `namesCredit`, `MAX_STATEMENT_LENGTH`,
    `ParsedStatement`, `StatementAuthor`
  - Links: `encodeShareHash`, `decodeShareHash`, `ShareData`, `SharePayloadInput`
  - Asks: `ASK_TARGETS`, `AskSchema`, `applyPatch`, `askStep`, `importAnswers`, `isMarker`,
    `levelOf`, `review`, `settledAt`, and the types `Ask`, `AskEvent`, `AskState`, `Choice`,
    `Decision`, `Difference`, `Level`, `Outcome`, `OrcidProof`, `Patch`, `Reply`, `Review`, `Target`
- `credit-matrix/lookup`: `lookupOrcidPerson`, `lookupDoiWork`, `normalizeDoi`, `DOI_INPUT_REGEX`,
  and the types `OrcidLookupResult`, `OrcidErrorCode`, `DoiLookupResult`, `DoiErrorCode`, `DoiAuthor`
- `credit-matrix/i18n`: `AVAILABLE_LOCALES`, `normalizeLocaleCode`, `hasCatalog`,
  `loadRoleCatalog`, `makeRoleTranslator`, `makeRoleDescriber`, `DEFAULT_ROLE_TRANSLATOR`,
  `loadUiCatalog`, `makeUiTranslator`, `DEFAULT_UI_TRANSLATOR`, and the types `LocaleCode`,
  `RoleCatalog`, `RoleDescriber`, `RoleTranslator`, `UiCatalog`, `UiKey`, `UiTranslator`
- `credit-matrix/element`: `CreditMatrixElement`

The palette, the limits and the merge helpers are internal: the web app imports core modules by
path (`@/core/author`, …), and users of the package get only the entry points above.

## Testing

```sh
pnpm test                          # from the repository root
pnpm --filter credit-matrix build  # dist/, as published
```

The core tests run under Node, with linkedom standing in for `DOMParser`. See
[CONTRIBUTING.md](https://github.com/simonvanlierde/credit-matrix/blob/main/CONTRIBUTING.md#testing)
for the package checks and how to update the type snapshot.
