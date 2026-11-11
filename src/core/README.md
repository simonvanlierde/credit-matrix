# credit-matrix

[CRediT (Contributor Roles Taxonomy)](https://credit.niso.org/) statements and exports, as the
[CRediT Matrix](https://credit.duinlab.nl) web app runs them in the browser. It is an ESM package
with types, with no tie to React, and runtime dependencies `zod` and `@lingui/core`.

```bash
npm install credit-matrix
```

```ts
import { generateStatement, importAny, toJats4rXml } from "credit-matrix";

const { authors } = await importAny(csvText); // JSON, CodeMeta, CSV, JATS4R or Crossref XML, a share link or names
generateStatement(authors, { format: "by-role" }); // "CRediT: Conceptualization: Grace Hopper; …"
toJats4rXml(authors);
```

## Entry points

| Import | Contents | Needs |
| --- | --- | --- |
| `credit-matrix` | the model and roles, statements, every format, heatmap SVG, links, asks | nothing (in Node, JATS import takes a parser) |
| `credit-matrix/lookup` | ORCID and DOI lookups | `fetch` |
| `credit-matrix/i18n` | role names and output strings in nine languages | nothing |
| `credit-matrix/figures` | embedded-font SVG and PDF heatmaps | bundled Noto fonts; PDF and font libraries |
| `credit-matrix/element` | registers the `<credit-matrix>` element ([docs](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/element.md)) | a DOM |

## CLI

The package also installs a `credit-matrix` command: the CLI, with an XML parser bundled. It needs
Node 22.19 or later. Run it with `npx credit-matrix` without installing, or with
`node src/core/dist/cli.js` from a clone after `pnpm --filter credit-matrix build`.

```bash
npx credit-matrix statement team.csv --format by-author --locale fr --levels
npx credit-matrix statement draft.json --format codemeta   # CodeMeta 3.0 people and roles
npx credit-matrix convert paper.xml --to json      # convert a JATS4R file to native JSON
npx credit-matrix convert team.csv --to crossref   # the <contributors> block of a Crossref deposit
npx credit-matrix convert team.csv --to jats --yes-no  # roles without a level
npx credit-matrix convert team.csv --to svg > heatmap.svg  # the heatmap; --locale sets its language
npx credit-matrix convert team.csv --to pdf > heatmap.pdf  # embedded fonts and selectable text
npx credit-matrix convert draft.json --to ro-crate > credit-ro-crate-fragment.json
npx credit-matrix convert team.csv --to quarto > authors.yml  # Quarto/Pandoc author metadata, with levels
npx credit-matrix convert team.csv --to myst > authors.yml    # MyST/Jupyter Book author metadata, without levels
npx credit-matrix ask draft.json --contributor "Grace Hopper" --blank
npx credit-matrix --help                           # or --version
```

Each command reads a file, or `-` for standard input, in any format `importAny` reads. Spreadsheet
files (.xlsx, .xls, .ods) are refused: save the sheet as CSV first. `statement --levels` adds Equal or
Supporting after each contribution below Lead. `statement` exits with 1 when nobody has a role yet.
`convert --to svg` and `--to pdf` write a warning to stderr, starting `credit-matrix: `, when the
heatmap's labels would print under 6 pt on a full page; the figure is still written.
`convert --to md` and `--to svg` take `--locale` too, for the language of the role names. `--to svg`
takes `--yes-no` for flat cells with no levels.
`--locale` also takes a regional tag: `de-DE` gives German, `pt-BR` Portuguese (Portugal), `zh-CN`
simplified Chinese. Traditional Chinese (`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant`) has no catalog and
gives English.

`statement --format` takes `by-role` (the default), `by-role-short`, `by-author`, `by-author-short`
or `codemeta`. See [CodeMeta attribution](#codemeta-attribution) for its output and limits.

`ask` prints a link that opens the contributor's own row in the web app (`--base-url` points it at
another copy). `--contributor` takes an id, a full name, or a first name or surname only one person
has; when nothing matches, the error lists the contributors. The link they send back can be read
with `convert`.

A mistake in the command line prints one line and exits with 2; any other error exits with 1.

### RO-Crate attribution

`credit-matrix convert draft.json --to ro-crate` exports people and linked CRediT roles for an existing RO-Crate 1.2 package.
`toRoCrateFragment(authors)` returns `{ metadata, warnings }` with the same fragment.
It includes proposed root links but no package title, date or licence, so it is not a standalone crate.
See [merging and validating the fragment](../../integrations/ro-crate/README.md).
Keep native JSON for scores and replies.

### CodeMeta attribution

`credit-matrix statement draft.json --format codemeta` prints a CodeMeta 3.0 attribution
fragment with `@context`, `author` and `contributor` fields. Each person with a score above zero
gets a `Person` record and one linked `Role` per active CRediT role. Non-authors go in
`contributor`. People with no active roles are absent. Names use the roster's structured fields;
particles, suffixes and supplied family-first names are preserved.

Merge these fields into the work's `codemeta.json`. The fragment has no software title, version
or release information. Use its `author` and `contributor` lists together, including their Person records.

A Person's `id` is their canonical ORCID URL when supplied. Otherwise, a fragment such as
`#credit-matrix-person-2` links their roles within this document. These local links use roster
positions, change when the roster order changes, and are not ORCIDs or persistent identities.
The CLI warns for each local link. Re-export the full attribution together instead of combining
local links from separate exports.

`Role.roleName` is the role's `credit.niso.org` URL. `schema:author` links each Role to its Person,
including roles in `contributor`. Scores and contribution levels have no slot in this export;
the CLI warns about that loss. Keep the native roster JSON for those values, equal contribution,
correspondence and replies.

The package also exports `toCodemeta(authors)`, returning `{ metadata, warnings }` without writing
to standard error. The [citesync integration check](../../integrations/codemeta/README.md) runs
the built CLI's output through the existing citation-file writer. CFF has no field for a general
contributor list or roles. Zenodo needs a separately chosen contributor type; a CRediT role does
not supply one.

## Domain model

An **`Author`** has identity fields (`id`, `name`, parsed name parts, deduplicated `initials`, and an
optional `orcid`), a `contributorType`, and a fixed array of 14 **`Contribution`** entries, one per
CRediT role.

Particles such as `van`, `de la` or `bin`, in any case, stay with the surname: "Anne van der Berg"
and "van der Berg, Anne" both have surname `van der Berg`. Initials skip them, so both are `AB`.

When an importer already knows the name parts, pass `firstName`, `middleName` and `surname`
to `createAuthor`. `normalizeRoster` preserves parts that spell the full name, including
family-first names with or without spaces. It does not infer family order from a display name.
The [shared name cases](../../conformance/names/README.md) record this contract.

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

- **`by-role`**: `CRediT: Conceptualization: Grace Hopper, Charles Darwin; Software: Grace Hopper; …`
- **`by-role-short`**: same grouping as `by-role`, using initials
- **`by-author`**: `CRediT: Grace Hopper: Conceptualization, Software; …`
- **`by-author-short`**: same grouping as `by-author`, using initials

The options you'll most likely want:

- `showLevels`: mark non-lead contributions with their level, after the role in by-author formats
  (for example `Software (Equal)`) and after the name in by-role formats
- `translateRole`: translate role names; the official English role names stay the keys inside
- `translateUi`: localize `Acknowledgements`, `Equal`, and `Supporting`
- `separateAcknowledgements`: keep non-author contributors on an `Acknowledgements:` line; defaults to
  `true`

Only non-zero contributions appear in statements.

`statementSpans(authors, options)` returns the same plain-text statement as a list of `{ text, cell?, authorId?, role? }`
spans, where `cell` names the contributor id and role a phrase stands for (the role in a by-author
statement, the name in a by-role one); `authorId` marks a name that is not itself a phrase (by-author), and `role` is set on a by-role statement's role label. Joined in order, the text is exactly `generateStatement`'s
output, so a viewer can tie each phrase back to its cell.

## Import / export

| Format      | Out               | In                                  |
| ----------- | ----------------- | ----------------------------------- |
| JATS4R XML  | `toJats4rXml`     | `fromJats4rXml`                     |
| CSV         | `toCsv`           | `fromCsv`                           |
| JSON        | `toJson`          | `fromJson`                          |
| Markdown    | `toMarkdown`      | —                                   |
| Quarto/Pandoc YAML | `toQuarto` | — |
| MyST/Jupyter Book YAML | `toMyst` | — |
| tenzing CSV | `toTenzing`       | `fromTenzing`                       |
| LaTeX ([latex-credits](https://github.com/Pseudomanifold/latex-credits)) | `toLatexCredits` | — |
| Crossref 5.5 `<contributors>` | `toCrossrefContributors` | `fromCrossrefContributors` |
| Heatmap SVG | `buildHeatmapSvg` | —                                   |

`toQuarto(authors, { yesNo: false })` returns an `author:` YAML block with names, ORCID iDs and
canonical CRediT roles with lead/equal/supporting degrees. Set `yesNo: true` to omit degrees.
Paste it into Quarto or Pandoc manuscript front matter. `toMyst(authors)` returns `authors:` with
ungraded roles; paste it into page front matter, or indent it under `project:` in `myst.yml`.
The app offers both under Export data, with Copy and Download. They list authors only, including
those with no roles yet. Acknowledge non-author contributors separately. Keep native JSON for
exact scores, equal-contribution and corresponding-author markers, and coauthor replies.

The [Quarto](https://quarto.org/docs/journals/authors.html#roles) schema supports contribution degrees;
the [MyST](https://mystmd.org/guide/frontmatter#authors) schema has role names only.
Use the [Quarto](../../integrations/quarto/README.md) or [MyST](../../integrations/myst/README.md)
plugin to render a statement from these blocks.

`buildHeatmapSvg` returns an SVG string that needs nothing else: it uses system fonts and embeds no
assets.
Its `<desc>` is the by-author contribution statement, so a screen reader hears who did what;
`heatmapDescription` returns that text, for an image's alt text or a PNG's Description field.

For embedded fonts, use the separate `credit-matrix/figures` entry. Create its renderer once; it loads
each font face when a figure first needs it:

```ts
import { createFigureRenderer } from "credit-matrix/figures";

const figures = createFigureRenderer();
const svg = await figures.svg(authors, { acronyms: false });
const pdf = await figures.pdf(authors, { acronyms: false }); // Uint8Array
```

The app downloads and CLI use this renderer. It embeds regular Noto Sans or Noto Serif fonts and measures labels
with their actual widths. Unsupported glyphs raise `FigureFontError`. Pass
`fallback: "system"` to `svg()` to draw them in the system font stack instead; `pdf()` always raises.
See the [figure font guide](../../integrations/figures/README.md) for offline use, supported scripts
and editor compatibility. The lightweight `buildHeatmapSvg` API keeps its system-font output.

The [figure options guide](../../integrations/heatmap.md) covers palettes, shapes, cell size, fonts, legends,
short labels and orientation for the JavaScript API, CLI and document plugins.

`fromCsv` needs a `Name` column. Other headers and role names match whatever their case or kind of
dash. A score cell is a number from 0 to 100 or a level word (`None`, `Supporting`, `Equal`, `Lead`).
Rows without a usable name are skipped.

`toTenzing` writes the columns of tenzing's example CSV. tenzing records a role as done or not, so
any score above 0 becomes `TRUE`, and equal contribution is not kept. Rows run in byline order:
authors in draft order, then acknowledgees, numbered on from the authors. Affiliations, email,
funding and declarations are left empty for the team.

`toLatexCredits` writes one granular `\credit` line per author, with each score as a fraction of 1,
so `\insertcreditsgranular` shades lead, equal and supporting differently. Acknowledgees are left out.

`fromJats4rXml(xml, { parser })` and `fromCrossrefContributors` read XML with `parser`, which defaults to the global `DOMParser`.
In Node, pass one, such as [linkedom](https://github.com/WebReflection/linkedom)'s:

```ts
import { DOMParser } from "linkedom";
fromJats4rXml(xml, { parser: new DOMParser() });
```

`detectFormat(text)` guesses the format from the text's shape, and `importAny(text, { parser })`
reads any of them, share links and [tenzing](https://github.com/marton-balazs-kovacs/tenzing)
spreadsheets (CSV or TSV) included. It returns the `format` it read, plus `asks`, `selfId` and
`title` when the format includes them. Text that assigns CRediT roles ("MG: conceptualization",
"Methodology, A.B.") or tells in sentences what the authors did is a `"statement"`, which
`importAny` refuses: a statement names roles, not contributors. It also throws `ExportOnlyError`
for Quarto or MyST author YAML and an RO-Crate fragment, which the app writes but cannot read back.

`parseStatement(text, authors)` reads a free-text CRediT statement against an author list of
`{ given, surname }` (`statementAuthor(author)` splits a contributor's name that way). It returns
`assignments`, each an author index and a role name, and `unresolved`: names or initials that fit
no author, or more than one, which it never guesses. `unmatched` lists each of those once, with
`candidates` (the author indices it could be, empty when none) and the `roles` left out for it.
It throws a `RangeError` on text longer than `MAX_STATEMENT_LENGTH` (120,000 characters); real
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
(`JSON_EXPORT_VERSION` in `export/json.ts`). It throws a `RepeatedIdError` for a file that repeats a
contributor id, and a `ZodError` for any other data that does not match.

## Asks and review

`ask.ts` models asking a co-author for their row and settling their answer. An **`Ask`** records when
the link was sent, whether it included your guess (`prefilled`), and the latest `reply`. A reply keeps
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

A reply can include an ORCID sign-in. The caller checks it and passes it on the `reply` event as
`orcid`; the reply keeps it as `provenance.orcid` (an `OrcidProof`). What "verified" means is
defined in the module comment of `orcid-proof.ts`. When a reply changes the row's iD, signed or not,
it keeps the iD the ask went to as `provenance.replacedOrcid`, and later replies keep it too.

Run `recheckSignIns(asks, fetchOrcidKeys)` on the `asks` that `fromJson` or `importAny` returns before
you show any sign-in as verified. `provenance.orcid` then holds only checked sign-ins: when ORCID
cannot be reached, each one moves to `provenance.uncheckedOrcid`, which you should not show as
verified, and a later check can still verify it. A sign-in counts only on the row id it signed for.

`importAnswers` then compares each sign-in with the row it lands on: when it was given for a row
with another id, name or iD, it sets `provenance.signedElsewhere`, which you should show as a
warning instead of as verified. The draft is not compared, since an export has no draft id, so a
copied file can bring a true sign-in into another draft. `fromJson` refuses a file that repeats a
row id.

To check a reply link's sign-in yourself, pass it to `verifyOrcidToken` with the keys from
`fetchOrcidKeys()`.

## Rosters and links

`createAuthor(name, fields)` builds one contributor and `parseAuthorText(text)` a list from pasted
names. `normalizeRoster(authors)` applies the rules every caller shares: at most 420 contributors,
ids unique and short enough for a link, and initials made unique.

`encodeShareHash(input, baseUrl)` writes a draft, or one contributor's row for an ask, into a
compressed `#s=…` link, and `decodeShareHash(hash)` reads one back (or returns `null`).

## Exports

The public API is what the entry points export. The
[type snapshot](https://github.com/simonvanlierde/credit-matrix/blob/main/src/core/__tests__/__snapshots__/public-api.d.ts.snap)
holds its exact shape. By entry point:

- `credit-matrix`
  - Model: `Author`, `Contribution`, `ContributionLevel`, `ContributorType`, `AuthorSchema`,
    `ContributionSchema`, `scoreToLevel`, `isValidOrcid`, `normalizeOrcid`, `MAX_AUTHORS`, `MAX_AUTHOR_NAME_LENGTH`, `MAX_IMPORT_BYTES`
  - Roles: `CREDIT_ROLES`, `getRoleByName`, `CreditRoleName`
  - Rosters: `createAuthor`, `parseAuthorText`, `normalizeRoster`
  - Statements: `generateStatement`, `statementSpans`, `STATEMENT_FORMATS`, `StatementFormat`, `StatementOptions`,
    `StatementSpan`, `StatementCell`
  - Formats: `toJson`, `fromJson`, `NewerVersionError`, `RepeatedIdError`, `toCsv`, `fromCsv`, `toJats4rXml`,
    `fromJats4rXml`, `XmlParser`, `XmlElement`, `XmlParseError`, `fromTenzing`, `isTenzing`, `toTenzing`, `toLatexCredits`,
    `toMarkdown`, `toCrossrefContributors`, `fromCrossrefContributors`, `buildHeatmapSvg`, `HeatmapOptionError`, `heatmapDescription`, `heatmapPrintWarning`, `HeatmapSvgOptions`, `detectFormat`,
    `importAny`, `ExportOnlyError`, `DetectedFormat`, `Imported`
  - Pasted statements: `parseStatement`, `statementAuthor`, `namesCredit`, `MAX_STATEMENT_LENGTH`,
    `ParsedStatement`, `StatementAuthor`
  - Links: `encodeShareHash`, `decodeShareHash`, `ShareData`, `SharePayloadInput`
  - Asks: `ASK_TARGETS`, `AskSchema`, `applyPatch`, `askStep`, `importAnswers`, `isMarker`,
    `levelOf`, `review`, `settledAt`, `recheckSignIns`, `fetchOrcidKeys`, `verifyOrcidToken`, and the types `Ask`, `AskEvent`, `AskState`, `Choice`,
    `Decision`, `Difference`, `Level`, `Outcome`, `OrcidKey`, `OrcidProof`, `Patch`, `Reply`, `Review`, `Target`
- `credit-matrix/lookup`: `lookupOrcidPerson`, `lookupDoiWork`, `normalizeDoi`, `DOI_INPUT_REGEX`,
  and the types `OrcidLookupResult`, `OrcidErrorCode`, `DoiLookupResult`, `DoiErrorCode`, `DoiAuthor`
- `credit-matrix/i18n`: `AVAILABLE_LOCALES`, `normalizeLocaleCode`, `resolveLocaleTag`, `hasCatalog`,
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

### Citation-file imports

`importAny` reads CodeMeta author names and ORCID iDs directly, leaving contribution roles empty.
CITATION.cff and .zenodo.json need an injected `convertCitation(text, format)` callback that returns
CodeMeta JSON from citesync. The web app supplies this through a lazy worker running citesync 0.4.0.
It loads a pinned Pyodide runtime and checksum-verified Python wheels, both from the web app's own site.
The file stays in the browser. A failed download leaves it available to retry or convert in the
[citesync playground](https://simonvanlierde.com/citesync/). CodeMeta imports work offline; citation
imports do after one online use.

`lookupDoiWork` returns optional `roles` on each contributor when Crossref deposits them with the
CRediT vocabulary. DataCite contributor types are not CRediT roles. The app previews deposited roles
and asks for confirmation before applying them; absent roles leave the matrix empty.
