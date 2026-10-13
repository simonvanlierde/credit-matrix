# CRediT observatory

How published papers use CRediT roles, extracted from open-access JATS. It feeds the field norms
and the "paste a statement" import in CRediT Matrix, and a dataset of per-author role facts.

Separate from the web app: a Python project run with [uv](https://docs.astral.sh/uv/), from this
directory.

## Run it

```sh
uv run observatory run       # read the pinned sample from the PMC bucket into data/sample-2026-10.duckdb
uv run observatory fields    # add a research field per journal, from OpenAlex
uv run observatory report    # markup styles, adoption per year, roles by author position, fields
```

Every command takes `--snapshot <name>` (default `sample-2026-10`) and `--db <path>` (default
`data/<snapshot>.duckdb`). `uv run observatory <command> --help` lists the rest.

### Where the articles come from

- **Which articles:** a manifest of PMCIDs. `snapshot` draws a stratified sample from Europe PMC
  (8 publishers × 2020–2025 × 15) into `snapshots/<name>.csv`. `candidates` lists every
  open-access article whose text uses "writing original draft" or "writing review editing",
  about 1.9 million; the list goes to `data/<name>.csv.gz` (too large for git) and its query,
  date and count to `snapshots/<name>.json`. A manifest that exists is never redrawn.
- **The XML:** `run` reads it from the [PMC Open Access Subset on
  AWS](https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/), anonymously over HTTPS, 32 downloads at a
  time (about 45 articles a second). It takes each article's newest version from the bucket's
  daily inventory and pins that inventory date in the database and in
  `snapshots/<name>.inventory`. It skips articles already in the database, so an interrupted
  run picks up where it stopped. Failed downloads are not stored and are retried next time.
- **Re-parsing:** `run` keeps a gzipped copy of each file in `data/xml-cache/` (about 30 KB an
  article, so about 55 GB for the full list). `run --fresh` rebuilds the database from it with
  one parser process per CPU, about 5,000 articles a second.
- **Fallback:** `fetch` and `extract` read the same manifest from Europe PMC's REST API instead
  (about 3 articles a second; `snapshots/<name>.sha256` pins each file's hash). Europe PMC strips
  the role attributes from some articles: in the sample, 71 of 720 read as free text there but as
  JATS4R or PLOS role URIs from the bucket. It also leaves out many ISSNs.

## What it reads

Publishers mark roles up in four ways. The extractor takes the strongest one an article has:

| Style | Markup | Seen at |
| --- | --- | --- |
| `jats4r` | `<role vocab="credit" vocab-term-identifier="https://credit.niso.org/...">` | Frontiers since late 2025, MDPI |
| `plos_uri` | `<role content-type="http://credit.niso.org/...">` | PLOS, Frontiers |
| `contrib_text` | free text per author: `<role>` lists, or `<fn fn-type="con">` footnotes (linked to the author, or in author order) | older Frontiers, eLife |
| `statement_text` | one statement naming authors by initials or full name | MDPI, Elsevier, Springer Nature, BMJ |

Statements are parsed by rules (`src/observatory/statement.py`). Initials are resolved against
the article's author list, including given names written as one word ("Q.M. Li" for Qinming
Li) and the extra letters Frontiers adds to tell authors apart ("YiL"). Initials that fit no
author or several are listed in `articles.unresolved`, never guessed. Only CRediT wording
counts, so prose such as "A.B. conceived the study" yields no roles.

## Tables

- `articles`: one row per article: stratum, PMC version and the XML's sha256, article type,
  DOI, journal, ISSNs, publisher, year, licence, style, the author list, author counts, the text
  the roles were read from, unresolved initials. Style is `error` when the XML does not parse
  and `missing` when the bucket has no XML for it.
- `assignments`: one row per author and role: PMCID, author position, name, ORCID, role slug.
- `journals`, `journal_keys` and the `article_fields` view (after `fields`): the field holding
  the largest share of each journal's OpenAlex topic counts, matched by ISSN or by a title only
  one journal has. A journal whose top field holds under 45% (PLOS ONE, Scientific Reports)
  counts as multidisciplinary. OpenAlex has no free bulk route to topics per article, so fields
  are per journal.
- `meta`: the inventory date the database was read from.

## Measuring accuracy

```sh
uv run observatory label --per-style 50   # blind sample to data/labels/<snapshot>.csv
# fill the gold column, e.g. "1: conceptualization, software; 2: writing - review & editing; all: validation"
uv run observatory score data/labels/sample-2026-10.csv
```

`label` samples articles whose roles were read from free text (`statement_text`,
`contrib_text`, and `none` with a statement that did not parse) and leaves the parser's output
out of the file, so a label is not anchored to its guess. `score` prints precision, recall and
F1 over (author, role) pairs, and the share of articles exactly right, per style.

## Limits

- The sample is drawn from the first 1,000 hits per publisher and year in Europe PMC's default
  order, not the whole stratum.
- The candidate query finds statements that use CRediT wording. Articles that tag roles without
  it, or that have no statement, are outside it, so it cannot give adoption rates on its own.
- Europe PMC and PMC are biomedical by construction.
- Raw XML stays in `data/`, which git ignores. Only PMCIDs, hashes and extracted role facts are
  meant for publication.
