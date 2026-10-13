# CRediT in JATS: conformance cases

A small set of test cases for tools that write [CRediT](https://credit.niso.org/) contributor
roles into JATS XML. Each case is a list of contributors with their roles, and the JATS that
[CRediT Matrix](https://credit.duinlab.nl) writes for it. Every expected file is checked against
the JATS 1.3 DTD and the [JATS4R Schematron rules](https://github.com/jats4r/jats-schematrons).

## What is here

Each case is two files in [`cases/`](cases/) with the same name:

- `NN-name.json`: the input, described below.
- `NN-name.xml`: the expected JATS output.

| Case | What it checks |
|---|---|
| `01-levels` | Roles at Lead, Equal and Supporting: each `<role>` has `degree-contribution`. |
| `02-yes-no` | Roles ticked yes or no, with no level: no `degree-contribution` at all. |
| `03-shared-first-two` | Two authors share first authorship: both get `equal-contrib="yes"`. |
| `04-shared-first-one` | Only one author is marked as sharing first authorship: no `equal-contrib`. |
| `05-corresponding` | A corresponding author: `corresp="yes"` on that `<contrib>` only. |
| `06-non-author` | Someone credited in the acknowledgements: `contrib-type="contributor"`. |
| `07-orcid` | ORCID iDs, given bare or as a URL, written as the full `https://orcid.org/` URI. |
| `08-non-ascii-names` | Accented, Vietnamese and Chinese names, a multi-word surname, an apostrophe. |

## The input format

```json
{
  "description": "What the case checks, in one sentence.",
  "mode": "levels",
  "contributors": [
    {
      "givenNames": "Ada",
      "surname": "Lovelace",
      "orcid": "0000-0002-1825-0097",
      "type": "author",
      "equalContribution": true,
      "corresponding": true,
      "roles": { "Conceptualization": "lead", "Methodology": "equal" }
    }
  ]
}
```

- `mode` is `"levels"` or `"yes-no"`. In `"levels"`, each role's value is `"lead"`, `"equal"` or
  `"supporting"`. In `"yes-no"`, each value is `"yes"`.
- Role names are the CRediT terms exactly as NISO writes them, including the en dash in
  "Writing – original draft" and "Writing – review & editing". A role that is not listed was
  not done.
- `type` is `"author"` (the default) or `"non-author"`.
- `orcid`, `equalContribution` and `corresponding` are optional.
- Contributors are in author order.

## What the expected output says

For each contributor, in order, there is one `<contrib>` with:

- `contrib-type="author"`, or `"contributor"` for a non-author. JATS leaves the values of
  `contrib-type` open.
- `equal-contrib="yes"` when two or more authors share first authorship. When only one author is
  marked, the attribute is left out: an equal contribution needs someone to be equal with, and
  the JATS4R rules reject a lone one.
- `corresp="yes"` for a corresponding author.
- `<contrib-id contrib-id-type="orcid">` with the full `https://orcid.org/` URI, as JATS4R asks.
- `<string-name>` with `<given-names>` and `<surname>`.
- One `<role>` per role, in the taxonomy's order, with `vocab="credit"`,
  `vocab-identifier="https://credit.niso.org/"`, `vocab-term` set to the CRediT term, and
  `vocab-term-identifier` set to the term's URL, with its trailing slash. These follow the
  [JATS4R CRediT recommendation](https://jats4r.niso.org/credit-taxonomy/).
- `degree-contribution` on each `<role>` in `"levels"` mode only, as `lead`, `equal` or
  `supporting`.

Some of these are choices the standards leave open. Another tool may make a different choice and
still be valid:

- JATS 1.3 does not fix the values of `degree-contribution`. The Tag Library shows them
  capitalised ("Lead"); these files use lower case.
- In the Tag Library, "Equal" means everyone contributed equally to that role. CRediT Matrix uses
  it for the middle of three levels, which is a looser reading.
- The `<article>` around the contributors is the smallest one the DTD accepts. It is there so the
  files validate; it is not part of what is being tested.

## Using the suite in your own tool

1. Read each `cases/*.json` file and turn it into your tool's own contributor data.
2. Write JATS from it.
3. Compare the `<contrib>` elements with the ones in the matching `.xml` file: their attributes,
   `<contrib-id>`, the name parts, and each `<role>` with its attributes and text. Whitespace,
   attribute order and the comment naming the generator do not matter.
4. Check your output against the DTD and the JATS4R rules, as below.

## The checks

In this repository, `pnpm validate:jats` runs both checks on every expected file
(see [`scripts/validate-jats.sh`](../scripts/validate-jats.sh)), and CI runs it on every change:

- **JATS 1.3 DTD.** `xmllint --valid`, with an XML catalog that maps the DOCTYPE to the
  [Journal Archiving and Interchange DTD v1.3](https://jats.nlm.nih.gov/archiving/1.3/) in
  [`test/jats-dtd/`](../test/jats-dtd/), so nothing is fetched from the network.
- **JATS4R rules**, version 0.0.17, compiled with SchXslt2 and run with SaxonJS. Two findings are
  expected and ignored:
  - The rules ask for `<permissions>`. Licence and copyright belong to the publisher, so the
    files do not carry them.
  - The rules' term list spells one role "Formal Analysis". NISO's term is
    ["Formal analysis"](https://credit.niso.org/contributor-roles/formal-analysis/), and the files
    use NISO's spelling.

A Vitest test (`src/core/__tests__/conformance.test.ts`) exports every input and fails if the
result differs from its expected file, so the cases always match what CRediT Matrix writes.

## Adding a case

Add a `NN-name.json` file and run `pnpm test` on your own machine. The test writes the missing
`.xml` file; read it to check it is right, then run `pnpm validate:jats`. In CI, a missing
expected file fails instead of being written.

## Licence

MIT, the same as the rest of this repository: see [`LICENSE`](../LICENSE). You may copy, change
and reuse the cases, including in other test suites, as long as the licence notice goes with them.
