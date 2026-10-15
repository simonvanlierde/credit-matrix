"""Turning JATS XML into the rows an extraction stores: the code whose hash is the parser version.

What decides which rows exist lives here too (which elements of a bulk file are articles, and the
stratum they get), so a change to it forces a re-parse and a change to downloading or writing does not.
"""

import gzip
import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

from census.jats import Article, parse_article, parse_element


@dataclass
class Rows:
    article: dict[str, object]
    roles: list[tuple[int, str]] = field(default_factory=list)
    """(author position, role slug) pairs, positions counted from 1."""
    paired: list[tuple[int, str]] = field(default_factory=list)
    """The statement parser's reading of a tagged article's statement, positions from 1."""

    @property
    def style(self) -> str:
        return str(self.article["style"])


def failed_row(pmcid: str, stratum: str, style: str, error: str, version: int | None = None) -> Rows:
    """`style` is "error" (the XML does not parse), "missing" (no XML to read) or "retry" (download failed)."""
    return Rows({"pmcid": pmcid, "stratum": stratum, "version": version, "style": style, "error": error})


def rows_for(pmcid: str, stratum: str, xml: bytes, version: int | None = None) -> Rows:
    """Rows for one article's XML (the bucket reader)."""
    digest = hashlib.sha256(xml).hexdigest()
    try:
        a = parse_article(xml)
    except Exception as error:  # one bad article must not stop a run over millions
        rows = failed_row(pmcid, stratum, "error", f"{type(error).__name__}: {error}", version)
        rows.article["xml_sha256"] = digest
        return rows
    return _rows(a, pmcid, stratum, version, digest, None)


def rows_for_element(element: etree._Element, stratum: str, unit: str) -> Rows | None:
    """Rows for one <article> of a bulk file, or None when it has no PMCID to key it by. The file's
    hash, in `units`, pins the XML; articles carry the file's name instead of their own hash."""
    ids = {i.get("pub-id-type"): (i.text or "").strip() for i in element.iterfind("front/article-meta/article-id")}
    pmcid = ids.get("pmcid") or (f"PMC{ids['pmc']}" if ids.get("pmc", "").isdigit() else "")
    if not pmcid.startswith("PMC"):
        return None
    try:
        a = parse_element(element)
    except Exception as error:
        rows = failed_row(pmcid, stratum, "error", f"{type(error).__name__}: {error}")
        rows.article["source_unit"] = unit
        return rows
    return _rows(a, pmcid, stratum, None, None, unit)


def _rows(a: Article, pmcid: str, stratum: str, version: int | None, digest: str | None, unit: str | None) -> Rows:
    article = {
        "pmcid": pmcid,
        "stratum": stratum,
        "source_unit": unit,
        "version": version,
        "xml_sha256": digest,
        "article_type": a.article_type,
        "doi": a.doi,
        "journal": a.journal,
        "issn": a.issn,
        "publisher": a.publisher,
        "year": a.year,
        "license": a.license,
        "style": a.style,
        "authors": [x.name for x in a.authors],
        "orcids": [x.orcid for x in a.authors],
        "n_authors": len(a.authors),
        "n_authors_with_roles": len({i for i, _ in a.assignments}),
        "statement": a.statement,
        "unresolved": a.unresolved,
    }
    return Rows(
        article,
        [(i + 1, slug) for i, slug in sorted(a.assignments)],
        [(i + 1, slug) for i, slug in sorted(a.paired or ())],
    )


def parse_file(path: Path, unit: str) -> list[Rows]:
    """Rows for every article with a PMCID in a gzipped bulk file."""
    rows = []
    with gzip.open(path) as stream:
        # The options of jats.PARSER: iterparse takes them as arguments, not as a parser.
        articles = etree.iterparse(
            stream, tag="article", resolve_entities=False, no_network=True, remove_comments=True, remove_pis=True
        )
        for _, element in articles:
            if (one := rows_for_element(element, "all", unit)) is not None:
                rows.append(one)
            # The file holds about 9,000 articles: free each one and the finished ones before it.
            element.clear(keep_tail=False)
            parent = element.getparent()
            while parent is not None and element.getprevious() is not None:
                del parent[0]
    return rows
