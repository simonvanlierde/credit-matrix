# CRediT census

How published papers use CRediT roles, read from open-access JATS. It feeds the field norms and
the "paste a statement" import in CRediT Matrix, and a public dataset of per-author role facts.

A Python project, separate from the web app. You need [uv](https://docs.astral.sh/uv/) 0.13 or
newer (it fetches Python 3.14 itself) and outbound HTTPS. The examples run from `census/`. From the
repo root, write `uv run --project census census <command>`: data and snapshots are always read from
and written to `census/`.

The order of use is the one `uv run census --help` prints: `run` or `bulk`, then `fields`, then
`report`, `export`, `label` or `score`.

## Run it on a sample

```sh
cd census
uv run census run       # read the pinned sample from the PMC bucket into data/sample-2026-10.duckdb
uv run census fields    # add a research field per journal, from OpenAlex
uv run census report    # markup styles, adoption per year, roles by author position, fields
```

The sample is 720 articles; the first `run` downloads the bucket inventory (about 50 MB) and the
articles (about 20 MB, kept gzipped in `data/xml-cache/`), in under two minutes. A correct run
ends with `inventory 2026-10-12T01-00Z: 80 contrib_text, 49 jats4r, 375 none, 84 plos_uri, 132
statement_text`; the counts change when the parser does.

`run` and `snapshot` default to `--snapshot sample-2026-10`. Every other command defaults to
`--snapshot oa-2026-10`, so add `--snapshot sample-2026-10` to run `fields`, `report` or `export` on
the sample. All of them take `--db <path>` (default `data/<snapshot>.duckdb`).
`uv run census <command> --help` lists the rest.

### Every open-access article

This downloads 169 GB into `data/bulk/`. The first run takes about 2.5 hours, downloads included;
a re-parse from the downloaded files takes about 36 minutes with 16 processes.

```sh
uv run census bulk      # all of Europe PMC's open-access subset into data/oa-2026-10.duckdb
uv run census fields    # research field per journal; reads OpenAlex's public Parquet from S3, no login
uv run census export    # the public dataset; refuses an incomplete database or one without fields
uv run census report
```

`bulk` reads Europe PMC's bulk files (`ftp.ebi.ac.uk/pub/databases/pmc/oa/`, 1,308 files of
about 9,000 articles), 16 files at a time, each downloaded once and parsed as it streams in (about
480 articles a second a process). Unlike Europe PMC's REST API, the files keep the role markup.
`--limit 2` reads just two files to try it. `export` takes `--partial` to write an incomplete
database or one without fields.

### Interrupted or changed parser

- **Interrupted run:** repeat the same command without `--fresh`. Finished files are kept and the
  rest are read again.
- **Changed parser or schema:** a command that writes refuses the database and tells you to rerun
  with `--fresh`. That deletes the database and re-parses; downloaded files are reused (about 36
  minutes for the full dataset). Commands that only read (`report`, `export`, ...) warn instead.
- **Exit codes:** 1 for a mistake you can fix, or a pin that does not match. 2 for an unfinished
  run: it stopped, files are unfinished, or a file's sha256 differs from the one committed in
  `snapshots/<name>.files.csv`.

### What makes a run reproducible

- **The manifest:** `snapshots/<name>.csv` lists the PMCIDs. `census snapshot` draws a new one,
  stratified by publisher and year from Europe PMC's search, and never overwrites one that exists.
- **The inventory:** `run` reads each article's newest version as of one daily inventory of the
  [PMC Open Access Subset on AWS](https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/). The date is pinned
  in `snapshots/<name>.inventory` and in the database; `--inventory latest` reads a newer one into
  a new database.
- **The parser:** the database records a hash of the parsing code (`roles.py`, `statement.py`,
  `jats.py` and `rows.py`) and a schema version derived from the table definitions. A run refuses a
  database built by other code; `--fresh` deletes it and re-parses from the cache.
- **The bulk listing:** the first `bulk` run writes the file list it reads (names and listed dates)
  to `snapshots/<name>.files.csv` and fills in each file's sha256 as it is read. A hash already
  committed is checked, never overwritten. Europe PMC replaces the files weekly and keeps no old
  versions, so the hashes are what pins the content.
- **The files:** a bucket article's sha256 is in `articles.xml_sha256`; a bulk article names its
  file in `articles.source_unit`. The OpenAlex snapshot date the fields came from is in `meta`.

Both commands work in units (a bulk file, or 200 manifest articles) and record each in the `units`
table. A rerun skips finished units and reads unfinished ones again, so an interrupted run picks up
where it stopped and failed downloads are retried. A run stops by itself when several units in a
row could not be downloaded.

## What it reads

Publishers mark roles up in four ways. The extractor takes the strongest one an article has:

| Style | Markup | Seen at |
| --- | --- | --- |
| `jats4r` | `<role vocab="credit" vocab-term-identifier="https://credit.niso.org/...">` | Frontiers since late 2025, MDPI |
| `plos_uri` | `<role content-type="http://credit.niso.org/...">` | PLOS, Frontiers |
| `contrib_text` | free text per author: `<role>` lists, or `<fn fn-type="con">` footnotes (linked to the author, or in author order) | older Frontiers, eLife |
| `statement_text` | one statement naming authors by initials or name | MDPI, Elsevier, Springer Nature, BMJ |

A role URL that is malformed ("contributor-roles/formal analysis/") is read from its term or text
and keeps its tagged style. Members of a consortium author are not counted as authors.

Statements are parsed by rules (`src/census/statement.py`). The parser splits a statement into
clauses and pairs authors with roles inside each, so a clause with no CRediT wording ("C.D. drew the
figures") cannot shift the rest. Initials are resolved against the author list, including
non-ASCII initials, particles ("F.d.S.N."), given names written as one word ("Q.M. Li" for Qinming
Li), Frontiers' extra letters ("YiL") and Vancouver style ("Nam KC"). Initials that fit no author
or several are listed in `articles.unresolved`, never guessed. Only CRediT wording counts, so prose
such as "A.B. conceived the study" yields no roles, and a statement needs at least one term prose
rarely uses (conceptualization, data curation, original draft, ...): "under the supervision of B.J."
or an ICMJE list with "Supervision" stays `none`, its text kept. Text that Europe PMC's bulk files
store double-encoded ("â\x80\x94" for an em dash) is repaired before parsing.

## Tables

- `articles`: one row per article: stratum, PMC version and the XML's sha256, article type, DOI,
  journal, ISSNs, publisher, year, licence, style, author names and ORCIDs (bare, in author
  order), author counts, the text the roles were read from, unresolved initials. Style is `error`
  when the XML does not parse and `missing` when the bucket has no XML for it.
- `assignments`: one row per author and role: PMCID, author position, role slug.
- `journals`, `journal_keys` and the `article_fields` view (after `fields`): the field holding the
  largest share of each journal's OpenAlex topic counts, matched by ISSN or by a title only one
  journal has. A journal whose top field holds under 45% (PLOS ONE, Scientific Reports) counts as
  multidisciplinary. OpenAlex has no free bulk route to topics per article, so fields are per
  journal.
- `paired`: for articles whose roles are tagged and that also print a statement, what the statement
  parser reads from it. The `paired_scores` view scores that against the tags per publisher, which
  measures the parser on tens of thousands of articles without hand labels.
- `units`: each bulk file or manifest chunk read, with its sha256, article count and whether it is
  finished.
- `meta`: the source, schema version, parser hash, inventory date, and the OpenAlex snapshot date
  and code hash the fields came from.

The database is local working data with author names in it. `census export` writes the public
dataset to `data/export/<snapshot>/`:

- `articles.parquet` and `assignments.parquet`: role facts and bare ORCIDs, CC0. These carry no
  author names.
- `statements.parquet`: the verbatim statement text of CC BY and CC0 articles only, each with its
  licence and style, under CC BY 4.0. The text names authors as the source does.
- `meta.json`: dataset and file-schema versions, export date, code commit and hashes, whether the
  run was complete, counts, licences per file, and the pins from `meta`.
- `README.md`: a column table for each file, the licences, and how to ask for an ORCID's removal.

Bare ORCIDs are personal data under the GDPR; they are published for research on contribution
practices. Export refuses a database with unfinished units or no fields unless told it is partial,
and replaces the previous export only once the new one is written.

## Measuring accuracy

`census report` includes the paired scores. For formats with no tagged twin, hand labels:

```sh
uv run census label --per-style 50   # blind sample to data/labels/<snapshot>.csv
# fill the gold column, e.g. "1: conceptualization, software; 2: writing - review & editing; all: validation"
uv run census score data/labels/sample-2026-10.csv
```

`label` samples articles whose roles were read from free text and leaves the parser's output out of
the file, so a label is not anchored to its guess. `score` prints precision, recall and F1 over
(author, role) pairs, and the share of articles exactly right, per style and per publisher.

## Validation

The paired scores cover only publishers that tag roles and also print a statement (MDPI, Frontiers,
OUP, SAGE and a few smaller ones). `census label --set` (seed 20261013) writes the hand-label set for the rest:

- `data/labels/oa-2026-10-set.csv`, 160 articles, blind like the `label` sample:
  - 100 `statement_text` and 30 `contrib_text` articles from publishers with fewer than 1,000 paired
    articles. Each style is split over publishers by the square root of their article count, so
    Elsevier, Springer Nature, Wiley and the rest get the most rows and BMJ and smaller publishers
    still some. Publishers under 0.5% of a style share an "(other)" stratum, named in `publisher`.
  - 30 `none` articles: a contributions text was found but no CRediT roles were read from it. A gold
    label other than `none` is a missed statement. Only 255,341 of the 6.1 million `none` articles
    keep such a text; the rest have none in the database, so their misses are not measured here.
  - 25 rows marked `overlap` for a second labeller. They fill a copy of the file on those rows, and
    `census score <first.csv> --second <copy.csv>` prints their agreement with the first labeller.
- `data/labels/oa-2026-10-set-disagreements.csv`: 20 MDPI articles where the parser and the tags
  disagree, with both shown. Fill `wrong` with `tag`, `parser`, `both` or `neither`, and `notes`;
  `census score` on that file counts the answers. If the tags are often the wrong ones, the paired
  F1 understates accuracy and needs these labels next to it.

Accuracy, to fill in after labelling (`census score data/labels/oa-2026-10-set.csv`):

| Style | Articles | Precision | Recall | F1 | Exact |
| --- | --- | --- | --- | --- | --- |
| `statement_text` | 100 | | | | |
| `contrib_text` | 30 | | | | |
| `none` | 30 | | | | |

Agreement between labellers on the 25 overlap rows: F1 \_\_. MDPI disagreements: tag wrong \_\_,
parser wrong \_\_, both \_\_, neither \_\_.

## Limits

- The sample is drawn from the first 1,000 hits per publisher and year in Europe PMC's default
  order, not the whole stratum.
- Europe PMC and PMC are biomedical by construction.
- Raw XML stays in `data/`, which git ignores.
- Python is pinned to 3.14 because duckdb has no 3.15 wheel yet.
- pyarrow is only the bridge into duckdb: the database writer inserts rows as Arrow batches.
