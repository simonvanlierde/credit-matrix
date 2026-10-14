"""The public dataset: role facts and bare ORCIDs under CC0, statement text only from CC BY and CC0 articles.

The role tables carry no author names; statement text is the source's own and names authors as it does.
"""

import hashlib
import json
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from census.fields import MULTIDISCIPLINARY, has_fields

DATASET_VERSION = "1.0.0"
"""Major: a file schema change that breaks readers. Minor: a new snapshot or an added column. Patch: a fix."""
EXPORT_SCHEMA = "1"
"""Version of the public files' columns and meanings, separate from the local database's schema."""
EXPORT_VERSION = hashlib.sha256(
    b"".join((Path(__file__).parent / name).read_bytes() for name in ("export.py", "fields.py"))
).hexdigest()[:12]
"""Changes with the code that shapes the export outside the parser."""

# CC BY (any version, no NC/ND/SA terms) and CC0, as a licence URL or as text.
OPEN_LICENCE = (
    r"(?i)creativecommons\.org/licenses/by/|creativecommons\.org/publicdomain/zero/|^\s*cc[ -]?by\s*\d|^\s*cc0\b"
)

LICENSES = {"articles.parquet": "CC0-1.0", "assignments.parquet": "CC0-1.0", "statements.parquet": "CC-BY-4.0"}

README = """# CRediT census: {name}

Per-author CRediT roles read from open-access articles by the CRediT census
(https://github.com/simonvanlierde/credit-matrix, census/). Counts, versions and provenance are in
meta.json.

The role tables (articles, assignments) carry no author names; PMCID and DOI lead to them at the
source. statements.parquet is the verbatim statement text of CC BY and CC0 articles and names
authors as the source does.

Bare ORCIDs are personal data under the GDPR. They are published from public scholarly metadata for
research on contribution practices. To have an ORCID removed, open an issue at
https://github.com/simonvanlierde/credit-matrix/issues.

## articles.parquet (CC0-1.0)

One row per article that parsed.

| Column | Type | Meaning |
| --- | --- | --- |
| pmcid | string | PubMed Central ID |
| doi | string | DOI, or null |
| year | int32 | publication year |
| publisher | string | publisher name as the article gives it |
| journal | string | journal title as the article gives it |
| field | string | OpenAlex field of the journal, see below |
| domain | string | OpenAlex domain of that field, see below |
| article_type | string | JATS article-type, e.g. `research-article` |
| style | string | where the roles were read from, see below |
| n_authors | int32 | authors in the byline, members of a consortium author not counted |
| n_authors_with_roles | int32 | authors with at least one role |
| license | string | the raw licence URL or text from the article |
| source_unit | string | Europe PMC bulk file the article was read from, or null |
| version | int32 | PMC article version (bucket sources), or null |
| xml_sha256 | string | sha256 of the article XML (bucket sources), or null |

`field` is the field holding the largest share of the journal's topic counts in OpenAlex,
`Multidisciplinary` (in `domain` too) when that share is under {multidisciplinary}, and null when the
journal matched no OpenAlex source. Fields are per journal, not per article.

`style` values:

- `jats4r`: roles tagged with `<role vocab="credit" vocab-term-identifier="https://credit.niso.org/...">`.
- `plos_uri`: roles tagged with `<role content-type="http://credit.niso.org/...">`.
- `contrib_text`: free-text roles per author (`<role>` lists or contribution footnotes).
- `statement_text`: one contribution statement naming authors by initials or name.
- `none`: no roles read. This includes statements that name roles only in common words, without a
  distinctive CRediT term such as conceptualization, data curation or original draft.

## assignments.parquet (CC0-1.0)

One row per author and role.

| Column | Type | Meaning |
| --- | --- | --- |
| pmcid | string | PubMed Central ID |
| author_position | int32 | the author's place in the byline, from 1, consortium members not counted |
| role | string | CRediT role slug from credit.niso.org, e.g. `writing-review-editing` (14 values) |
| orcid | string | bare ORCID (`0000-0002-1825-0097`) when the article gives one, else null |

## statements.parquet (CC-BY-4.0)

The contribution text of articles under CC BY or CC0 only. Each row keeps its source licence;
cite the article by its PMCID.

| Column | Type | Meaning |
| --- | --- | --- |
| pmcid | string | PubMed Central ID |
| license | string | the raw licence URL or text from the article |
| style | string | the article's style, see below |
| statement | string | the statement as printed, see below |

Roles were read from this text when `style` is `contrib_text` or `statement_text`, from tags when
it is `jats4r` or `plos_uri`, and not at all when it is `none`. A `contrib_text` statement joins
each author's text by author position: `1: text; 2: text`.
"""


def export(con: duckdb.DuckDBPyConnection, out: Path, name: str, partial: bool = False) -> dict[str, int]:
    """Write the dataset to `out` and return its row counts.

    Refuses a database with unfinished units or no fields unless `partial`. Writes to a sibling
    directory first, so a failed export leaves the previous one in place.
    """
    (units_total, units_finished) = con.execute(
        "SELECT count(*), count(*) FILTER (finished) FROM units"
    ).fetchone() or (0, 0)
    fielded = has_fields(con)
    complete = bool(units_total) and units_total == units_finished and fielded
    if not complete and not partial:
        raise ValueError(
            f"{units_finished}/{units_total} units finished, fields {'built' if fielded else 'missing'}:"
            " finish the run and `census fields`, or export with --partial"
        )
    field = "f.field, f.domain" if fielded else "CAST(NULL AS VARCHAR) AS field, CAST(NULL AS VARCHAR) AS domain"
    join = "LEFT JOIN article_fields f USING (pmcid)" if fielded else ""
    queries = {
        "articles": f"""
            SELECT a.pmcid, a.doi, a.year, a.publisher, a.journal, {field}, a.article_type, a.style,
                   a.n_authors, a.n_authors_with_roles, a.license, a.source_unit, a.version, a.xml_sha256
            FROM articles a {join} WHERE a.style NOT IN ('error', 'missing', 'retry') ORDER BY a.pmcid""",
        "assignments": """
            SELECT s.pmcid, s.author_position, s.role, a.orcids[s.author_position] AS orcid
            FROM assignments s JOIN articles a USING (pmcid) ORDER BY ALL""",
        "statements": f"""
            SELECT pmcid, license, style, statement FROM articles
            WHERE statement IS NOT NULL AND regexp_matches(coalesce(license, ''), '{OPEN_LICENCE}')
            ORDER BY pmcid""",
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=f".{out.name}.", dir=out.parent))
    try:
        counts = {}
        for table, query in queries.items():
            path = tmp / f"{table}.parquet"
            con.execute(f"COPY ({query}) TO '{path}' (FORMAT parquet)")
            (counts[table],) = con.execute(f"SELECT count(*) FROM read_parquet('{path}')").fetchone() or (0,)
        provenance = dict(con.execute("SELECT key, value FROM meta ORDER BY key").fetchall())
        # One digest over every finished unit's file hash: names the exact bulk files the data came from.
        (units, digest) = con.execute(
            "SELECT count(*), sha256(string_agg(unit || ' ' || sha256, '\n' ORDER BY unit)) FROM units"
            " WHERE finished AND sha256 IS NOT NULL"
        ).fetchone() or (0, None)
        if units:
            provenance |= {
                "files": str(units),
                "files_digest": digest,
                "files_digest_recipe": "sha256 over '<unit> <sha256>' per finished unit, sorted by unit, joined"
                " by newlines",
            }
        meta = {
            "name": name,
            "dataset_version": DATASET_VERSION,
            "export_schema": EXPORT_SCHEMA,
            "exported_at": datetime.now(UTC).date().isoformat(),
            "code_commit": _commit(),
            "code": {"export": EXPORT_VERSION, "multidisciplinary": MULTIDISCIPLINARY},
            "complete": complete,
            "units_total": units_total,
            "units_finished": units_finished,
            "counts": counts,
            "licenses": LICENSES,
            "citation": {"title": f"CRediT census: {name}", "doi": None},
            "provenance": provenance,
        }
        (tmp / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        (tmp / "README.md").write_text(README.format(name=name, multidisciplinary=MULTIDISCIPLINARY))
        tmp.chmod(0o755)  # mkdtemp makes it owner-only
        # Two renames, not one atomic swap: a kill between them leaves the old export at `.<name>.old`.
        old = out.with_name(f".{out.name}.old")
        shutil.rmtree(old, ignore_errors=True)
        if out.exists():
            out.rename(old)
        tmp.rename(out)
        shutil.rmtree(old, ignore_errors=True)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return counts


def _commit() -> str | None:
    """The repository's HEAD commit, or None outside a git checkout."""
    try:
        run = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent, capture_output=True, text=True, check=True
        )
    except OSError, subprocess.CalledProcessError:
        return None
    return run.stdout.strip() or None
