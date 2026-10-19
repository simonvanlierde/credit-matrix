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

The web app's paste-a-statement import runs a TypeScript port of `roles.py` and `statement.py`
(`src/core/statement.ts`). A test there runs it over `tests/corpus.jsonl` and requires the same
output as `expected` here, so a change to one parser needs the same change in the other. One
step differs in form only: `roles.clean` replaces dashes with the spaces around them before it
collapses runs of spaces, and the port collapses spaces first, because the first order takes
quadratic time on a long run of spaces in a browser. The output is the same. The comment for this
lives here, not in `roles.py`: the database pins a hash of that file's bytes.

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

`census aggregate` writes the counts the app's census page shows to `public/data/census.json` (about
10 KB, committed): research articles and those with roles per year, roles per author, styles per
year, fields and the 20 largest publishers in the last full year, the share of authors with roles
holding each role by byline place, and the paired F1 with how much of it comes from MDPI and
Frontiers. Groups under 1,000 articles are left out, and the years start at the first with 1,000
articles with roles. The last full year is the one before the newest year with 1,000 articles. It
holds no names and no article rows, and records the snapshot, dataset version, code commit, parser
hash and OpenAlex sources date. Like `export`, it refuses an incomplete database unless given
`--partial`.

## Measuring accuracy

`census report` includes the paired scores. For formats with no tagged twin, hand labels:

```sh
uv run census label --per-style 50   # blind sample to data/labels/<snapshot>.csv
# fill the gold column, e.g. "1: conceptualization, software; 2: writing - review & editing; all: validation"
uv run census score data/labels/sample-2026-10.csv
```

`label` samples articles whose roles were read from free text and leaves the parser's output out of
the file, so a label is not anchored to its guess. It also leaves out the style (the parser's verdict
on the text) and shuffles the rows. `score` prints precision, recall and F1 over
(author, role) pairs, and the share of articles exactly right with a 95% interval, per style. It
takes the style from the database, not the CSV.

## Validation

The paired scores cover only publishers with 1,000 or more tagged articles that also print a
statement (MDPI, Frontiers, OUP, SAGE, The Royal Society, AAAS and Pensoft). `census label --set`
(seed 20261013) writes the hand-label set for the rest:

- `data/labels/oa-2026-10-set.csv`, 160 articles for the labeller: `pmcid`, `overlap`, `authors`,
  `text` and `gold`, shuffled, blind like the `label` sample. Each article's stratum and weight are
  in `data/labels/oa-2026-10-set-key.csv`, which the labeller does not open: a stratum or weight
  would give away the style. Within each style, publishers get rows by the square root of their
  article count; publishers under 0.5% of a style share an "(other)" stratum.
  - 100 `statement_text` articles (about 707,000 in the pool). Springer Nature gets 27 rows over
    its BMC (11), Nature Publishing Group (11) and Springer (5) strata; Elsevier and articles with
    no publisher get 12 each, "(other)" 11, Wiley 10 and Wolters Kluwer 7, then 2 to 4 each for
    RSC, ACS, ASBMB, BMJ, KeAi, Taylor & Francis and the Company of Biologists.
  - 30 `contrib_text` articles (about 22,400 in the pool, two thirds of them eLife). eLife gets 7
    rows; 13 of the other 23 go to Brazilian society journals, one each.
  - 30 `none` articles from every publisher: a contributions text was found but no CRediT roles
    were read from it. A gold label other than `none` is a missed statement. Only 255,341 of the
    6.1 million `none` articles keep such a text; misses in the other 5.9 million are not measured.
  - A key file's `weight` is a stratum's article count over its rows. Square-root allocation draws
    small publishers more often than their size, so `score` counts each row by its weight; the
    article counts it prints are unweighted. `score` reads `<labels>-key.csv` beside the labels, or
    the file given with `--key`; without one, every row weighs 1 under the database's publisher.
  - 25 rows marked `overlap` for a second labeller. Copy the blank file before anyone labels it;
    the second labeller fills only the overlap rows of the copy, and
    `census score <first.csv> --second <copy.csv>` prints their agreement on those rows.
- `data/labels/oa-2026-10-set-disagreements.csv`: 20 MDPI articles where the parser and the tags
  disagree, with both shown, drawn with their own seed so the label set can change without changing
  them. Fill `wrong` with `tag`, `parser`, `both` or `neither`, and `notes`; `census score` on that
  file counts the answers. If the tags are often the wrong ones, the paired F1 understates accuracy.

What the set can show, once labelled (`census score data/labels/oa-2026-10-set.csv`):

| Style | Articles | Precision | Recall | F1 | Exact (95% interval) |
| --- | --- | --- | --- | --- | --- |
| `statement_text` | 100 | | | | |
| `contrib_text` | 30 | | | | |
| `none` | 30 | | | | |

These are pooled, weighted figures per style. `score` also prints a table per style and publisher,
but with 1 to 12 rows per stratum it is for spotting failure patterns, not for accuracy per
publisher. Agreement between labellers, one figure over the 25 overlap rows: F1 \_\_. MDPI
disagreements, a rough verdict on whether the tag or the parser errs from 20 rows: tag wrong \_\_,
parser wrong \_\_, both \_\_, neither \_\_.

## Training a statement parser

Articles with tagged roles that also print a statement are free training pairs: the statement is the
input, the tags are the answer.

```sh
uv run census model split     # pin the held-out 5% in data/model/<snapshot>/split.csv; prints its sha256
uv run census model dataset   # train.jsonl and held_out.jsonl: statement, authors, gold pairs, licence
uv run census model score     # the rule parser on the held-out set, per style and publisher
uv run census model score preds.jsonl           # other predictions on the articles they cover
uv run census model score preds.jsonl --rules   # the rule parser on those same articles
uv run census model zero-shot --model Qwen/Qwen3.5-9B --limit 200   # an open model, zero-shot
uv run census model zero-shot --model Qwen/Qwen3.5-9B --labels data/labels/oa-2026-10-set.csv
uv run census score data/labels/oa-2026-10-set.csv --predictions preds.jsonl   # against the hand labels
```

The split holds out every twentieth group of identical statements, in publisher and year order, so
each publisher and year gets its share and no statement text sits on both sides. A pinned split is
never redrawn. The `oa-2026-10` split has sha256
`fe3b1264b06d3fe98a9373cda8f9f46408f98b2ac4cf462f458f16f37683e43a`. Only rows with `publishable`
true (CC BY or CC0) may be shared; the files name authors and stay in `data/`. Predictions are
JSONL lines `{"pmcid": ..., "pairs": [[position, slug], ...]}`. Both scorers count them the way
`census score` counts the parser: precision, recall and F1 over (author, role) pairs pooled across
articles (F1 is twice the right pairs over twice the right pairs plus the wrong and missed ones), the share of articles exactly right with a 95% interval, and `-` for a rate
with nothing to count. An article without a prediction predicts nothing. `model score` weighs every
held-out article 1; `census score --predictions` uses the label set's key-file weights.

`zero-shot` asks any chat-completions server (`--base-url`, default `http://localhost:8000/v1`) for
JSON that fits a schema, 32 requests at a time (`--workers`) so the server can batch them. It writes
to `data/model/<snapshot>/predictions/`, one file per model and set, and skips articles already
there, so a stopped run resumes. On one 24 GB GPU, vLLM serves Qwen3.5-9B quantized to FP8 when
loading (the first start downloads about 19 GB to the Hugging Face cache):

```sh
docker run -d --name vllm-census --gpus all --ipc=host -p 127.0.0.1:8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  vllm/vllm-openai:v0.31.0 Qwen/Qwen3.5-9B \
  --quantization fp8 --max-model-len 8192 --gpu-memory-utilization 0.90 \
  --limit-mm-per-prompt '{"image": 0, "video": 0}'
```

The requests turn the model's reasoning block off (`chat_template_kwargs`, a vLLM extension).

## Limits

- The sample is drawn from the first 1,000 hits per publisher and year in Europe PMC's default
  order, not the whole stratum.
- Europe PMC and PMC are biomedical by construction.
- Raw XML stays in `data/`, which git ignores.
- Python is pinned to 3.14 because duckdb has no 3.15 wheel yet.
- pyarrow is only the bridge into duckdb: the database writer inserts rows as Arrow batches.
