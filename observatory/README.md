# CRediT observatory

How published papers use CRediT roles, extracted from Europe PMC's open-access JATS. It
feeds the field norms and the "paste a statement" import in CRediT Matrix, and a dataset of
per-author role facts.

Separate from the web app: a Python project run with [uv](https://docs.astral.sh/uv/).

## Run it

```sh
cd observatory
uv run observatory fetch     # download the pinned sample's JATS into data/xml/ and check the hashes
uv run observatory extract   # parse it into data/observatory.duckdb
uv run observatory report    # articles and author coverage per publisher and markup style
```

`uv run observatory snapshot --snapshot <name>` draws a new sample. A manifest that exists is
never redrawn: a snapshot is a fixed list of PMCIDs in `snapshots/<name>.csv` plus the sha256
of each article's XML in `snapshots/<name>.sha256`. `fetch` exits 1 when Europe PMC now serves
different XML for a pinned article.

## What it reads

Publishers mark roles up in four ways. The extractor takes the strongest one an article has:

| Style | Markup | Seen at |
| --- | --- | --- |
| `jats4r` | `<role vocab="credit" vocab-term-identifier="https://credit.niso.org/...">` | Frontiers since late 2025 |
| `plos_uri` | `<role content-type="http://credit.niso.org/...">` | PLOS |
| `contrib_text` | free text per author: `<role>` lists, or a `<fn fn-type="con">` the author links to | older Frontiers, eLife |
| `statement_text` | one statement naming authors by initials or full name | MDPI, Elsevier, Springer Nature, BMJ |

Statements are parsed by rules (`src/observatory/statement.py`). Initials are resolved against
the article's author list, including given names written as one word ("Q.M. Li" for Qinming
Li) and the extra letters Frontiers adds to tell authors apart ("YiL"). Initials that fit no
author or several are listed in `articles.unresolved`, never guessed. Only CRediT wording
counts, so prose such as "A.B. conceived the study" yields no roles. Statements that name a
role but do not parse are kept in `articles.statement` for labelling.

## Tables

- `articles`: one row per article: publisher stratum, article type (corrections and editorials have no
  statement), DOI, journal, year, licence, style
  (`error` when the XML does not parse), author counts, the statement text, unresolved initials.
- `assignments`: one row per author and role: PMCID, author position, name, ORCID, role slug.

## Limits

- The sample is drawn from the first 1,000 hits per publisher and year in Europe PMC's default
  order, not the whole stratum. The full run will read the bulk open-access files instead.
- Accuracy is not measured yet. It needs a hand-labelled sample, the next step.
- The publisher strata are biomedical by construction (Europe PMC). Field classification is
  not done yet.
- Raw XML stays in `data/`, which git ignores. Only PMCIDs, hashes and extracted role facts are
  meant for publication.
