# Shared structured-name cases

`people-v1.json` is the canonical name corpus for CRediT Matrix, citesync and codemeta-drift.
The case expectations are hand-written. Consumers copy its exact bytes and record the source
path, Git blob revision and SHA-256 beside the copy in `SOURCE.json`.
A Git blob identifies content independently of a release or commit.

The fields have separate contracts:

- `matrix` holds explicitly supplied name parts and expected initials, not a display-name guess.
- `cff` holds the original CFF person fields.
- `codemeta` holds NFC given/family names after CFF's particle and suffix are folded into the family name.
- `zenodo_name`, when present, supplies a comma-form name for the Zenodo reader.
- `equivalent_names` are one-string aliases of that structured identity, used by citesync.
- `orcid_cases` distinguish normalization from checksum validation.

Names use deceased scientists and the fictional Josiah Carberry. The suffix case is a fictional
name variant; its ORCID is the published Carberry test identifier, not a scientist's identifier.
The invalid ORCID differs in its check digit and cannot identify a person.

Family-first and unspaced CJK cases supply explicit parts. The corpus does not ask a parser to
infer family order from an ambiguous string. Matrix keeps its existing suffix convention;
citesync folds CFF's `name-suffix` into the CodeMeta family name. These are different contracts.

When a case changes, review its expected values and update all three copies and hash pins.
