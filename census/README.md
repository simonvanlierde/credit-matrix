# CRediT census

How published papers use CRediT roles, read from open-access JATS. It feeds the field norms and
the "paste a statement" import in CRediT Matrix, and a public dataset of per-author role facts.

A Python project, separate from the web app. You need [uv](https://docs.astral.sh/uv/) 0.13 or
newer (it fetches Python 3.14 itself) and outbound HTTPS. Commands work from any directory.

## Run it

```sh
cd census
uv run census run       # read the pinned sample from the PMC bucket into data/sample-2026-10.duckdb
uv run census fields    # add a research field per journal, from OpenAlex
uv run census report    # markup styles, adoption per year, roles by author position, fields
```

The sample is 720 articles; the first `run` downloads the bucket inventory (about 50 MB) and the
articles (about 20 MB, kept gzipped in `data/xml-cache/`), in under two minutes. A correct run
ends with `inventory 2026-10-12T01-00Z: 80 contrib_text, 49 jats4r, 353 none, 84 plos_uri, 154
statement_text`; those counts change when the parser does.

Every command takes `--snapshot <name>` (default `sample-2026-10`) and `--db <path>` (default
`data/<snapshot>.duckdb`). `uv run census <command> --help` lists the rest.

### What makes a run reproducible

- **The manifest:** `snapshots/<name>.csv` lists the PMCIDs. `census snapshot` draws a new one,
  stratified by publisher and year from Europe PMC's search, and never overwrites one that exists.
- **The inventory:** `run` reads each article's newest version as of one daily inventory of the
  [PMC Open Access Subset on AWS](https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/). The date is pinned
  in `snapshots/<name>.inventory` and in the database; `--inventory latest` reads a newer one into
  a new database.
- **The parser:** the database records a hash of the parsing code and the schema version. A run
  refuses a database built by other code; `--fresh` deletes it and re-parses from the cache.
- **The files:** each article's sha256 is in `articles.xml_sha256`; the OpenAlex snapshot date the
  fields came from is in `meta`.

`run` skips articles already in the database, so an interrupted run picks up where it stopped. A
failed download is not stored and is tried again next time; a run stops by itself when nearly all
recent downloads fail.

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
such as "A.B. conceived the study" yields no roles.

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
- `meta`: the schema version, parser hash, inventory date and OpenAlex snapshot date.

The database is local working data. Author names and statement text stay in it; the public
dataset will hold role facts and ORCIDs only, with statement text just for CC BY and CC0 articles.

## Measuring accuracy

```sh
uv run census label --per-style 50   # blind sample to data/labels/<snapshot>.csv
# fill the gold column, e.g. "1: conceptualization, software; 2: writing - review & editing; all: validation"
uv run census score data/labels/sample-2026-10.csv
```

`label` samples articles whose roles were read from free text and leaves the parser's output out of
the file, so a label is not anchored to its guess. `score` prints precision, recall and F1 over
(author, role) pairs, and the share of articles exactly right, per style.

## Limits

- The sample is drawn from the first 1,000 hits per publisher and year in Europe PMC's default
  order, not the whole stratum.
- Europe PMC and PMC are biomedical by construction.
- Raw XML stays in `data/`, which git ignores.
