# CLI reference

`credit-matrix` reads a contributor file in any format CRediT Matrix imports and prints a CRediT
statement, an export, or a link that asks one contributor to check their roles. This page covers
every command, flag, exit code and the way input and output work. The examples all use the file in
[The example file](#the-example-file) and were run for real.

The CLI is built for scripts and for tools that call it. If you write a manuscript by hand, the
[app](https://credit.duinlab.nl) does the same jobs without a terminal.

## Install and run

The CLI needs Node 22.19 or later. It ships in the `credit-matrix` npm package.

```sh
npx credit-matrix --version
pnpm dlx credit-matrix --version
```

From a clone of this repository, build the core once and run the built file:

```sh
pnpm install --frozen-lockfile
pnpm --filter credit-matrix build
node src/core/dist/cli.js --version
```

Examples below write `credit-matrix`; use whichever form you installed.

The `svg` and `pdf` figures need the Noto fonts. The README of the
[`credit-matrix` package](../src/core/README.md#cli) explains how the CLI finds them, when it
downloads them, and the one network request it makes.

## Usage

```text
credit-matrix <command> <file> [options]
credit-matrix --help | --version
```

| Command | What it prints |
| --- | --- |
| [`statement`](#statement) | The CRediT statement, or linked CodeMeta |
| [`convert`](#convert) | The contributions in another format |
| [`ask`](#ask) | A link that asks one contributor to check their roles |

The command comes first, then the file, then the flags in any order. A flag that a command does
not use is accepted and ignored (`statement --to csv` prints the statement).

Flags that take a value accept `--flag value` and `--flag=value`. When you repeat a flag, the last
one wins, except `--font-path`, which collects every value.

### Global flags

| Flag | Short | Type | Default | Effect |
| --- | --- | --- | --- | --- |
| `--help` | `-h` | boolean | off | Print the usage text and exit 0. |
| `--version` | `-v` | boolean | off | Print the package version and exit 0. Wins over `--help`. |

Both work without a command or file.

## The example file

Every example reads this `contributors.json`. It has three authors and one non-author contributor.
The file is the native JSON export of the app (**Export data**, **JSON**), cut down to the fields
that matter. The role names are the NISO names; note the en dash in `Writing – original draft`.

```json
{
  "version": 1,
  "authors": [
    {
      "id": "ada",
      "name": "Ada Lovelace",
      "firstName": "Ada",
      "middleName": "",
      "surname": "Lovelace",
      "initials": "AL",
      "orcid": "0000-0002-1825-0097",
      "contributions": [
        { "role": "Conceptualization", "score": 100 },
        { "role": "Writing – original draft", "score": 100 },
        { "role": "Software", "score": 40 }
      ]
    },
    {
      "id": "rosalind",
      "name": "Rosalind E. Franklin",
      "firstName": "Rosalind",
      "middleName": "E.",
      "surname": "Franklin",
      "initials": "REF",
      "contributions": [
        { "role": "Supervision", "score": 100 },
        { "role": "Conceptualization", "score": 50 },
        { "role": "Writing – original draft", "score": 20 }
      ]
    },
    {
      "id": "alan",
      "name": "Alan M. Turing",
      "firstName": "Alan",
      "middleName": "M.",
      "surname": "Turing",
      "initials": "AMT",
      "contributions": [{ "role": "Software", "score": 100 }]
    },
    {
      "id": "grace",
      "name": "Grace Hopper",
      "firstName": "Grace",
      "middleName": "",
      "surname": "Hopper",
      "initials": "GH",
      "contributorType": "non-author",
      "contributions": [{ "role": "Validation", "score": 30 }]
    }
  ]
}
```

A score runs from 0 to 100. It maps to a level: 67 to 100 is lead, 34 to 66 is equal, 1 to 33 is
supporting, 0 is no contribution. Ada's Software score of 40 is therefore an equal contribution.
`contributorType` is `author` unless the file says `non-author`. Keep the names in a file like
this one and refer to people by `id` on the command line, so a name never has to pass through
shell quoting.

## Input

Every command takes a `<file>`: a path, or `-` for standard input.

```sh
cat contributors.json | credit-matrix statement -
```

The format comes from the content, not the file name. The CLI reads:

- the native JSON export, and a JSON file that is a CodeMeta, CITATION.cff or Zenodo record
- CSV with a `Name` header cell, and Tenzing CSV or TSV
- JATS4R XML and the `<contributors>` block of Crossref XML
- a share link, including the reply link a contributor sends back after `ask`
- a statement written as text
- a plain list of names, which gives contributors without roles

Limits and special cases:

- A file over 2 MB is refused, and so is a roster of more than 420 contributors.
- UTF-8 (with or without a byte order mark) and UTF-16 with a byte order mark (Excel's "Unicode
  Text" export) are read. Excel and OpenDocument files (`.xlsx`, `.xls`, `.ods`), ZIP files and
  files with a NUL byte are refused with a request to save the sheet as CSV.
- A JSON file that fails validation names up to three failing fields, for example
  `bad.json is not a CRediT Matrix JSON export. Check authors.0.name, authors.0.firstName,
  authors.0.middleName and 3 more.`
- A JSON file that repeats a contributor `id` is refused: `<file> repeats a contributor id.`
- For standard input, JSON validation messages say `The input` where they would say the file name.

## Output

- The result goes to standard output. A text result gets a closing newline if it has none.
- `convert --to pdf` writes binary bytes. Redirect them to a file; do not print them to a terminal.
- Warnings and the font report go to standard error and start with `credit-matrix: `. They do not
  change the exit code and do not appear in a redirected result.
- On an error, nothing is written to standard output.

## Exit codes

| Code | Meaning | Triggers |
| --- | --- | --- |
| 0 | Success | The result was printed, with or without warnings. `--help` and `--version`. |
| 1 | The command line was fine but the work failed | File not found, a directory, or permission denied. A spreadsheet, a ZIP or a file over 2 MB. XML that is not well formed. JSON or another format that does not validate. No roles assigned yet, for `statement` and `convert --to latex-credits`. `ask` finds no contributor, or several. The figure fonts cannot draw a character, or the font family is missing. |
| 2 | The command line is wrong | No command, an unknown command, no file, an unknown option or a missing option value. `convert` without `--to`, or with an unknown one. An unknown `--format`, `--locale` or heatmap value. `ask` without `--contributor`. |

Exit 2 also prints `Run 'credit-matrix --help' for usage.` after the message.

```text
$ credit-matrix statment contributors.json
credit-matrix: Unknown command: statment. Did you mean 'statement'?
Run 'credit-matrix --help' for usage.
$ echo $?
2
```

The "Did you mean" hint appears when the typo is within two edits of a command.

## Locales

`--locale` sets the language of role names and fixed words such as "Acknowledgements". It applies
to `statement` (except `--format codemeta`), `convert --to md`, and the labels in `convert --to svg`
and `--to pdf`. Other exports ignore it.

| Code | Language |
| --- | --- |
| `en` (default) | English |
| `fr` | French |
| `de` | German |
| `es` | Spanish |
| `it` | Italian |
| `pt-PT` | Portuguese (Portugal) |
| `nl` | Dutch |
| `zh-Hans` | Simplified Chinese |
| `ja` | Japanese |

The CLI also accepts other spellings of these. It ignores case, reads `_` as `-` and drops a
region it has no catalog for: `PT` gives `pt-PT`, `zh` gives `zh-Hans`, `fr-CA` gives `fr` and
`ja_JP` gives `ja`. `zh-Hant`, `zh-TW`, `zh-HK` and `zh-MO` give English without a warning, since
there is no Traditional Chinese catalog. A code the CLI cannot place exits 2:

```text
$ credit-matrix statement contributors.json --locale xx
credit-matrix: Unknown locale: xx. Use one of en, fr, de, es, it, pt-PT, nl, zh-Hans, ja.
```

## statement

```text
credit-matrix statement <file> [--format <format>] [--locale <code>] [--levels]
```

Prints the CRediT statement. Non-author contributors go in a separate "Acknowledgements" paragraph.

| Flag | Type | Default | Values |
| --- | --- | --- | --- |
| `--format` | string | `by-role` | `by-role`, `by-role-short`, `by-author`, `by-author-short`, `codemeta` |
| `--locale` | string | `en` | See [Locales](#locales) |
| `--levels` | boolean | off | Adds (Equal) or (Supporting) after each contribution below lead |

The formats:

- `by-role` lists the people under each role, with full names.
- `by-role-short` does the same with initials.
- `by-author` lists the roles under each person.
- `by-author-short` does the same with initials.
- `codemeta` prints linked CodeMeta 3.0 JSON, with non-authors under `contributor`. It ignores
  `--locale` and `--levels`. It warns on standard error about each person without an ORCID iD,
  whose link only identifies them inside the document, and that CodeMeta omits scores.

The statement exits 1 with `No roles assigned yet: the statement is empty.` when nobody has a role.

### Example: default

```text
$ credit-matrix statement contributors.json
CRediT: Conceptualization: Ada Lovelace, Rosalind E. Franklin; Software: Ada Lovelace, Alan M. Turing; Supervision: Rosalind E. Franklin; Writing – original draft: Ada Lovelace, Rosalind E. Franklin

Acknowledgements: Validation: Grace Hopper
```

### Example: initials with levels

```text
$ credit-matrix statement contributors.json --format by-author-short --levels
CRediT: AL: Conceptualization, Software (Equal), Writing – original draft; REF: Conceptualization (Equal), Supervision, Writing – original draft (Supporting); AMT: Software

Acknowledgements: GH: Validation (Supporting)
```

### Example: another language

```text
$ credit-matrix statement contributors.json --format by-author --locale fr
CRediT: Ada Lovelace : Conceptualisation, Logiciel(s), Rédaction - ébauche du manuscrit initial ; Rosalind E. Franklin : Conceptualisation, Supervision, Rédaction - ébauche du manuscrit initial ; Alan M. Turing : Logiciel(s)

Remerciements : Grace Hopper : Validation
```

### Example: CodeMeta

Standard error shows first:

```text
$ credit-matrix statement contributors.json --format codemeta
credit-matrix: Rosalind E. Franklin has no ORCID iD; their link identifies them only within this document.
credit-matrix: Alan M. Turing has no ORCID iD; their link identifies them only within this document.
credit-matrix: Grace Hopper has no ORCID iD; their link identifies them only within this document.
credit-matrix: CodeMeta omits scores and contribution levels; keep the original roster JSON.
{
  "@context": "https://w3id.org/codemeta/3.0",
  "author": [
    {
      "type": "Person",
      "id": "https://orcid.org/0000-0002-1825-0097",
      "name": "Ada Lovelace",
      "givenName": "Ada",
      "familyName": "Lovelace"
    },
    {
      "type": "Role",
      "schema:author": "https://orcid.org/0000-0002-1825-0097",
      "roleName": "https://credit.niso.org/contributor-roles/conceptualization/"
    },
    ... (Ada's other roles, then the other authors, trimmed)
  ],
  "contributor": [
    {
      "type": "Person",
      "id": "#credit-matrix-person-4",
      "name": "Grace Hopper",
      "givenName": "Grace",
      "familyName": "Hopper"
    },
    {
      "type": "Role",
      "schema:author": "#credit-matrix-person-4",
      "roleName": "https://credit.niso.org/contributor-roles/validation/"
    }
  ]
}
```

## convert

```text
credit-matrix convert <file> --to <target> [--yes-no] [--locale <code>] [figure flags]
```

Prints the contributions in another format. `--to` is required.

| Flag | Type | Default | Effect |
| --- | --- | --- | --- |
| `--to` | string | none | One of the targets below. |
| `--yes-no` | boolean | off | Treat roles as ticks with no level. Used by `jats`, `latex-credits`, `quarto`, `svg`, `pdf`. |
| `--locale` | string | `en` | Used by `md`, `svg` and `pdf`. See [Locales](#locales). |

### Targets

| `--to` | Prints | Notes |
| --- | --- | --- |
| `json` | Native JSON export (version 1) | Keeps scores, ORCID iDs, markers and ask answers. Use it to move a roster between tools. |
| `csv` | One row per person, one column per role | Scores 0 to 100. Also has columns for type, equal contribution and corresponding. |
| `jats` | JATS4R `<contrib-group>` in a minimal `<article>` | Roles carry a `degree-contribution` level unless `--yes-no`. |
| `crossref` | The `<contributors>` block of a Crossref deposit (schema 5.5.0) | Has no levels. Non-authors get the role type `other`. |
| `md` | A Markdown table of people and roles | Role names follow `--locale`. Levels shown as (Equal), (Supporting). |
| `latex-credits` | `\credit` lines for the latex-credits package | One value from 0 to 1 per role (the score divided by 100); `--yes-no` writes 1 or 0. Authors only. Exits 1 if nobody has a role. |
| `tenzing` | A Tenzing-style CSV table | Non-authors are marked "Acknowledgment only". |
| `quarto` | Author YAML for Quarto and Pandoc | Levels kept unless `--yes-no`. Authors only. |
| `myst` | Author YAML for MyST and Jupyter Book | Never has levels. Authors only. |
| `ro-crate` | An RO-Crate 1.2 attribution fragment | Not a complete crate: merge it into your package metadata. Warns on standard error. |
| `svg` | The contribution heatmap as SVG | Embeds Noto fonts. See [figure flags](#figure-flags). |
| `pdf` | The contribution heatmap as PDF | Same flags as `svg`. Binary output. |

Scores and levels survive only in `json`, `csv`, `jats`, `md`, `quarto`, `latex-credits`, `svg`
and `pdf`. `crossref`, `myst`, `ro-crate` and `tenzing` drop them. Keep the JSON file as your
source of truth.

An unknown or missing `--to` exits 2:

```text
$ credit-matrix convert contributors.json --to docx
credit-matrix: convert needs --to json, csv, jats, crossref, md, latex-credits, tenzing, svg, pdf, quarto, myst or ro-crate.
Run 'credit-matrix --help' for usage.
```

### Figure flags

These apply to `--to svg` and `--to pdf`. Any of them with another target is ignored. A bad value
exits 2.

| Flag | Type | Default | Allowed |
| --- | --- | --- | --- |
| `--color` | string | `#1f4e79` | A 3 or 6 digit hex color. Overrides `--palette`. |
| `--palette` | string | `blue` | `blue`, `green`, `gray` |
| `--shape` | string | `square` | `square`, `rounded`, `circle` |
| `--size` | number | `22` | Cell size in pixels, above 0 and up to 256 |
| `--legend` | boolean word | `true` | `true`, `false` |
| `--legend-position` | string | `auto` | `auto`, `right`, `bottom` |
| `--labels` | string | `full` | `full`, `short` |
| `--horizontal` | boolean | off | Put people on the columns and roles on the rows. |
| `--marks` | boolean word | `false` | `true` draws a mark in each filled cell, for print in grayscale. |
| `--skipempty` | boolean word | `true` | `false` keeps roles nobody has. |
| `--initials` | boolean word | `true` | `false` writes names, not initials, on the axis. |
| `--font-size` | number | automatic | 6 to 32, in pixels |
| `--font` | string | Noto Sans | `sans`, `serif`, or an installed font family name |
| `--font-path` | string, repeatable | none | A folder to search for the `--font` family before the system fonts |
| `--ignore-system-fonts` | boolean | off | Search only the `--font-path` folders |
| `--font-fallback` | string | `sans` | `sans`, `serif`: the Noto face that draws characters the family lacks |

The "boolean word" flags need a value: write `--legend false`, not `--legend`.

With `--font <family>`, the CLI draws Latin and the other characters the family has in that
family. It prints the file it used to standard error. Noto Sans, or Noto Serif for a serif family
or `--font-fallback serif`, draws the rest. A missing family exits 1.

If the labels would print under 6 pt on a full page, the CLI warns on standard error and still
writes the figure. A character no bundled font can draw exits 1 and names the character.

### Example: JSON

`convert` to `json` fills in every default, so the output is longer than the input. Only the start
is shown:

```text
$ credit-matrix convert contributors.json --to json
{
  "version": 1,
  "authors": [
    {
      "id": "ada",
      "name": "Ada Lovelace",
      "firstName": "Ada",
      "middleName": "",
      "surname": "Lovelace",
      "initials": "AL",
      "orcid": "0000-0002-1825-0097",
      "contributorType": "author",
      "contributions": [
        {
          "role": "Conceptualization",
          "score": 100
        },
        {
          "role": "Data curation",
          "score": 0
        },
        ... (the other roles and people, trimmed)
```

### Example: CSV

```text
$ credit-matrix convert contributors.json --to csv
Name,ORCID,Type,Equal contribution,Corresponding,Conceptualization,Data curation,Formal analysis,Funding acquisition,Investigation,Methodology,Project administration,Resources,Software,Supervision,Validation,Visualization,Writing – original draft,Writing – review & editing
Ada Lovelace,0000-0002-1825-0097,author,no,no,100,0,0,0,0,0,0,0,40,0,0,0,100,0
Rosalind E. Franklin,,author,no,no,50,0,0,0,0,0,0,0,0,100,0,0,20,0
Alan M. Turing,,author,no,no,0,0,0,0,0,0,0,0,100,0,0,0,0,0
Grace Hopper,,non-author,no,no,0,0,0,0,0,0,0,0,0,0,30,0,0,0
```

### Example: JATS4R

The output is a complete `<article>` with an XML declaration and a doctype. The first part:

```text
$ credit-matrix convert contributors.json --to jats
<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD with MathML3 v1.3 20210610//EN" "JATS-archivearticle1-3-mathml3.dtd">
<!-- Generated by CRediT Matrix · https://credit.duinlab.nl -->
<article article-type="other" dtd-version="1.3">
  <front>
    <article-meta>
      <contrib-group>
    <contrib contrib-type="author">
      <contrib-id contrib-id-type="orcid">https://orcid.org/0000-0002-1825-0097</contrib-id>
      <string-name>
        <given-names>Ada</given-names>
        <surname>Lovelace</surname>
      </string-name>
        <role vocab="credit" vocab-identifier="https://credit.niso.org/" vocab-term="Conceptualization" vocab-term-identifier="https://credit.niso.org/contributor-roles/conceptualization/" degree-contribution="lead">Conceptualization</role>
        <role vocab="credit" vocab-identifier="https://credit.niso.org/" vocab-term="Software" vocab-term-identifier="https://credit.niso.org/contributor-roles/software/" degree-contribution="equal">Software</role>
        ... (trimmed)
    </contrib>
    ... (the other contributors, trimmed; Grace Hopper has contrib-type="contributor")
```

### Example: Crossref

```text
$ credit-matrix convert contributors.json --to crossref
<!-- Generated by CRediT Matrix · https://credit.duinlab.nl · Crossref schema 5.5.0 -->
<contributors>
  <person_name sequence="first">
    <given_name>Ada</given_name>
    <surname>Lovelace</surname>
    <role vocab="crossref" type="author"/>
    <role vocab="credit" type="conceptualization"/>
    <role vocab="credit" type="software"/>
    <role vocab="credit" type="writing-original-draft"/>
    <ORCID>https://orcid.org/0000-0002-1825-0097</ORCID>
  </person_name>
  <person_name sequence="additional">
    <given_name>Rosalind E.</given_name>
    <surname>Franklin</surname>
    <role vocab="crossref" type="author"/>
    <role vocab="credit" type="conceptualization"/>
    <role vocab="credit" type="supervision"/>
    <role vocab="credit" type="writing-original-draft"/>
  </person_name>
  <person_name sequence="additional">
    <given_name>Alan M.</given_name>
    <surname>Turing</surname>
    <role vocab="crossref" type="author"/>
    <role vocab="credit" type="software"/>
  </person_name>
  <person_name sequence="additional">
    <given_name>Grace</given_name>
    <surname>Hopper</surname>
    <role vocab="crossref" type="other"/>
    <role vocab="credit" type="validation"/>
  </person_name>
</contributors>
```

### Example: Markdown

```text
$ credit-matrix convert contributors.json --to md --locale nl
| Contributor | CRediT roles |
| --- | --- |
| Ada Lovelace | Conceptualisatie, Software (Gelijk), Schrijven – eerste versie |
| Rosalind E. Franklin | Conceptualisatie (Gelijk), Supervisie, Schrijven – eerste versie (Ondersteunend) |
| Alan M. Turing | Software |
| Grace Hopper | Validatie (Ondersteunend) |

<!-- Generated by CRediT Matrix · https://credit.duinlab.nl -->
```

### Example: latex-credits

The file lists authors only. Values run 0 to 1 in CRediT order.

```text
$ credit-matrix convert contributors.json --to latex-credits
% CRediT contributions for the latex-credits package
% (https://github.com/Pseudomanifold/latex-credits). Put credits.sty next to your .tex file, then:
%   \usepackage{credits}           % in the preamble; the option skipempty hides unused roles
%   \insertcreditsgranular        % in the text: the role table, shaded by level
%   \insertcreditsgranularstatement  % or: the statement as sentences
% Values run 0 to 1 in CRediT order. Lead is 1, equal 0.66, supporting 0.33.
% Acknowledgees are left out: the package lists authors only.
% Names outside Latin scripts need lualatex or xelatex with a suitable font.
% Generated by CRediT Matrix · https://credit.duinlab.nl
\credit{Ada Lovelace}{1,0,0,0,0,0,0,0,0.4,0,0,0,1,0}
\credit{Rosalind E. Franklin}{0.5,0,0,0,0,0,0,0,0,1,0,0,0.2,0}
\credit{Alan M. Turing}{0,0,0,0,0,0,0,0,1,0,0,0,0,0}
```

The values are the scores divided by 100 (0.4, 0.5, 0.2), not the 1, 0.66 and 0.33 level shades
that the header comment and `--help` describe. `--yes-no` turns every non-zero value into 1.

### Example: Tenzing

```text
$ credit-matrix convert contributors.json --to tenzing
Author/Acknowledgee,Order in publication,Firstname,Middle name,Surname,Conceptualization,Data curation,Formal analysis,Funding acquisition,Investigation,Methodology,Project administration,Resources,Software,Supervision,Validation,Visualization,Writing - original draft,Writing - review & editing,Notes,Affiliation 1,Affiliation 2,Affiliation 3,Funding,ORCID iD,Email address,Corresponding author?,Declares
Author,1,Ada,,Lovelace,TRUE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,TRUE,FALSE,FALSE,FALSE,TRUE,FALSE,,,,,,0000-0002-1825-0097,,FALSE,
Author,2,Rosalind,E.,Franklin,TRUE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,TRUE,FALSE,FALSE,TRUE,FALSE,,,,,,,,FALSE,
Author,3,Alan,M.,Turing,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,TRUE,FALSE,FALSE,FALSE,FALSE,FALSE,,,,,,,,FALSE,
Acknowledgment only,4,Grace,,Hopper,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,TRUE,FALSE,FALSE,FALSE,,,,,,,,FALSE,
```

### Example: Quarto

```text
$ credit-matrix convert contributors.json --to quarto
# Keep native JSON for scores, author markers and replies.
# Non-author contributors are left out; acknowledge them separately.
author:
  - name: "Ada Lovelace"
    orcid: "0000-0002-1825-0097"
    roles:
      - "Conceptualization": lead
      - "Software": equal
      - "Writing – original draft": lead
  - name: "Rosalind E. Franklin"
    roles:
      - "Conceptualization": equal
      - "Supervision": lead
      - "Writing – original draft": supporting
  - name: "Alan M. Turing"
    roles:
      - "Software": lead
```

### Example: MyST

```text
$ credit-matrix convert contributors.json --to myst
# Keep native JSON for scores, author markers and replies.
# Non-author contributors are left out; acknowledge them separately.
# MyST omits contribution levels; all listed roles are ungraded.
authors:
  - name: "Ada Lovelace"
    orcid: "0000-0002-1825-0097"
    roles:
      - "Conceptualization"
      - "Software"
      - "Writing – original draft"
  - name: "Rosalind E. Franklin"
    roles:
      - "Conceptualization"
      - "Supervision"
      - "Writing – original draft"
  - name: "Alan M. Turing"
    roles:
      - "Software"
```

### Example: RO-Crate

The fragment lists people, roles and the NISO terms. Merge it into your own `ro-crate-metadata.json`.
Standard error shows first:

```text
$ credit-matrix convert contributors.json --to ro-crate
credit-matrix: Rosalind E. Franklin has no ORCID iD; their link identifies them only within this document.
credit-matrix: Alan M. Turing has no ORCID iD; their link identifies them only within this document.
credit-matrix: Grace Hopper has no ORCID iD; their link identifies them only within this document.
credit-matrix: This attribution fragment is not a standalone RO-Crate; merge it into your package metadata.
credit-matrix: RO-Crate attribution omits scores and contribution levels; keep the original roster JSON.
{
  "@context": "https://w3id.org/ro/crate/1.2/context",
  "@graph": [
    {
      "@id": "./",
      "author": [
        {
          "@id": "https://orcid.org/0000-0002-1825-0097"
        },
        {
          "@id": "#credit-matrix-role-1"
        },
        ... (trimmed)
      ],
      "contributor": [
        {
          "@id": "#credit-matrix-person-4"
        },
        {
          "@id": "#credit-matrix-role-8"
        }
      ]
    },
    {
      "@id": "https://orcid.org/0000-0002-1825-0097",
      "@type": "Person",
      "name": "Ada Lovelace",
      "givenName": "Ada",
      "familyName": "Lovelace"
    },
    ... (roles, people and DefinedTerm entries, trimmed)
  ]
}
```

### Example: SVG heatmap

```sh
credit-matrix convert contributors.json --to svg > heatmap.svg
```

The file is about 23 KB: most of it is the embedded font in a `<style>` block. Without that
block, the start of the file reads:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="259.86263847719346" height="242.34972299459537" viewBox="0 0 259.86263847719346 242.34972299459537" role="img" xml:lang="en" lang="en">
<style>... (@font-face rule with the base64 font, trimmed)</style>
<!-- Generated by CRediT Matrix · https://credit.duinlab.nl -->
<title>Contribution heatmap</title>
<desc>CRediT: Ada Lovelace: Conceptualization, Software (Equal), Writing – original draft; Rosalind E. Franklin: Conceptualization (Equal), Supervision, Writing – original draft (Supporting); Alan M. Turing: Software

Acknowledgements: Grace Hopper: Validation (Supporting)</desc>
<rect width="259.86263847719346" height="242.34972299459537" fill="#ffffff"/>
<text transform="translate(152.43650000000002,40.34972299459535) rotate(-45)" text-anchor="start" font-size="11" fill="#16181c" xml:space="preserve"><tspan font-family="'Noto Sans'">AL</tspan></text>
... (labels, cells and legend, trimmed)
```

The `<title>` and `<desc>` give the figure a text alternative with the full statement. Figure
options combine in one call:

```sh
credit-matrix convert contributors.json --to svg --palette green --shape circle \
  --labels short --horizontal --legend-position bottom --marks true --size 18 > heatmap.svg
```

### Example: PDF heatmap

```sh
credit-matrix convert contributors.json --to pdf > heatmap.pdf
```

The result is a 10 KB PDF 1.7 file (it starts with `%PDF-1.7`) with embedded fonts and selectable
text. The CLI prints nothing on standard output besides the bytes.

## ask

```text
credit-matrix ask <file> --contributor <name or id> [--blank] [--base-url <url>]
```

Prints one link that asks a contributor to check their roles in the app, or with `--blank` to
fill them in from scratch. The link carries only that person's row and the file's title, in the
URL fragment, so the app's server never receives it. The reply link the contributor sends back
reads with `convert` (`credit-matrix convert reply.txt --to json`).

| Flag | Type | Default | Effect |
| --- | --- | --- | --- |
| `--contributor` | string | none (required) | Who to ask. |
| `--blank` | boolean | off | Send the row with all scores at 0. |
| `--base-url` | string | `https://credit.duinlab.nl/` | The app the link opens. Not checked: any text is accepted. |

`--contributor` matches in this order: the `id`; the full name, ignoring case and accents'
composition; a first name or surname that only one person has. If several people share it, the
command exits 1 and lists them: give the full name or the `id`. No match also exits 1 and lists
up to 10 names.

Prefer the `id`, so a name does not go through the shell. To get one link for each person:

```sh
jq -r '.authors[].id' contributors.json | while read -r id; do
  credit-matrix ask contributors.json --contributor "$id"
done
```

Each link contains a fresh random draft id and the current time, so two runs print different
links for the same person.

### Example

```text
$ credit-matrix ask contributors.json --contributor ada
https://credit.duinlab.nl/#s=VYqxCsMwDAV_pbxZAtmR7URb9_5ByGDHDhRKMxSSIeTfC4UWyi0Hdwc2mCdUGEqqS9Mc2JdYWMOSuAzRsYaSuuZdbIuCMMOQawZhh7k0qHZ9F726QMiw8cD9dzxhuNZ8ua1be-S5gbDCICLCIuLZ9T6wyJBAeMFGJ0L_6Fc-aTqn8w0
```

With a blank form and another app address:

```text
$ credit-matrix ask contributors.json --contributor rosalind --blank --base-url https://example.org/credit/
https://example.org/credit/#s=dcq9CsIwFIbhWynffCJJcxKbs-sFuJYO-VEIlhRa0KH03l1cHOSdHnh3vCA9oUBg870k51hpk6xi_3AqsfVKD5qtNyn7EEDIEKzLFufaCggJYghviDkHZjtY33s2hAgZd9TfuUFw-7K7nLrrGttzrg2EDTJq-tt0TMcH
```

The CLI does not set the yes/no flag that links from the app can carry.

## Recipes

All of them keep names in `contributors.json` and out of the command line.

Pipe a converted file into the next step:

```sh
credit-matrix convert contributors.json --to jats | xmllint --noout -
```

Print a statement from a spreadsheet saved as CSV:

```sh
credit-matrix statement team.csv --format by-author --levels
```

Fail a CI job when nobody has a role. `statement` exits 1:

```sh
credit-matrix statement contributors.json > /dev/null
```

Keep warnings out of a log but still see errors:

```sh
credit-matrix convert contributors.json --to ro-crate 2>/dev/null > fragment.json
```

Use `2>/dev/null` with care: it also hides the error message when the command exits 1 or 2. Check
the exit code (`$?`) as well.

## Behavior to know about

These are as the code behaves today.

- A flag the command does not use is silently ignored, so `statement --to csv` and
  `convert --to csv --locale fr` do not warn.
- With no roles, `statement` and `latex-credits` exit 1, but `csv`, `jats`, `crossref`, `md`,
  `tenzing`, `quarto`, `myst`, `ro-crate`, `svg` and `pdf` print an empty roster and exit 0.
- `--version` wins over `--help`, and both win over a missing command.
- `--size 0` and `--size abc` report "Heatmap size must be between 0 and 256", but 0 is not
  allowed: the size must be above 0.
- `--palette`, `--shape` and `--labels` errors do not list the allowed values. See
  [Figure flags](#figure-flags).
- `convert --to latex-credits` writes the scores divided by 100, where `--help` and the file's own
  header comment say it writes level shades.
