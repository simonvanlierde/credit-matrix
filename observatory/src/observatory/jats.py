"""Extract per-author CRediT roles from a JATS article, whichever markup the publisher used."""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from observatory.roles import clean, find_roles, slug_from_url
from observatory.statement import Author, parse_statement

XLINK = "{http://www.w3.org/1999/xlink}"
ALI = "{http://www.niso.org/schemas/ali/1.0/}"

# Strongest first: an article with several gets the first one it has.
STYLES = ("jats4r", "plos_uri", "contrib_text", "statement_text", "none")
"""
- jats4r: <role vocab="credit" vocab-term-identifier="https://credit.niso.org/...">
- plos_uri: <role content-type="http://credit.niso.org/...">
- contrib_text: free text per author, in <role> (older Frontiers) or a linked <fn fn-type="con"> (eLife)
- statement_text: one free-text statement naming authors by initials or name
- none: no CRediT roles found
"""

# "Author contributions", "CRediT authorship contribution statement", "Contributors", "Contributions";
# not Frontiers' "Contribution to the field".
_STATEMENT_TITLE_RE = re.compile(r"author|credit|contributor|^\W*contributions?\W*$", re.IGNORECASE)
_CON_ID_RE = re.compile(r"con\d+")


@dataclass
class Article:
    pmcid: str | None = None
    article_type: str | None = None
    doi: str | None = None
    journal: str | None = None
    issn: list[str] = field(default_factory=list)
    publisher: str | None = None
    year: int | None = None
    license: str | None = None
    authors: list[Author] = field(default_factory=list)
    style: str = "none"
    assignments: set[tuple[int, str]] = field(default_factory=set)
    """(author index, role slug) pairs."""
    statement: str | None = None
    """The free text the roles were read from (for contrib_text, "1. Name: text" per author), parsed or not.
    Kept for labelling."""
    unresolved: list[str] = field(default_factory=list)


def _text(el: ET.Element | None) -> str:
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""


def _author(contrib: ET.Element) -> Author:
    name = contrib.find("name")
    orcid = next(
        (_text(c) for c in contrib.findall("contrib-id") if c.get("contrib-id-type") == "orcid"),
        None,
    )
    if name is not None:
        return Author(_text(name.find("given-names")), _text(name.find("surname")), orcid)
    return Author("", _text(contrib.find("collab")) or _text(contrib.find("string-name")), orcid)


def _contrib_roles(contrib: ET.Element, fns: dict[str, str]) -> tuple[list[tuple[str, str]], list[str]]:
    """(style, slug) for each role tagged on one author, and the free text it came from."""
    found, texts = [], []
    for role in contrib.findall("role"):
        if role.get("vocab") == "credit":
            slug = slug_from_url(role.get("vocab-term-identifier", ""))
            found += [("jats4r", slug)] if slug else []
        elif slug := slug_from_url(role.get("content-type", "")):
            found.append(("plos_uri", slug))
        else:
            texts.append(_text(role))
    texts += [fns[rid] for x in contrib.findall("xref") if (rid := x.get("rid", "")) in fns]
    found += [("contrib_text", s) for t in texts for _, _, s in find_roles(clean(t))]
    return found, texts


def _holds_statement(el: ET.Element) -> bool:
    if el.tag == "notes" and "contribution" in (el.get("notes-type") or ""):
        return True
    if el.tag in {"sec", "fn-group", "notes"}:
        return bool(_STATEMENT_TITLE_RE.search(_text(el.find("title"))))
    # BMJ: <fn><p><bold>Contributors:</bold> ...
    return el.tag == "fn" and bool(_STATEMENT_TITLE_RE.search(_text(el.find("p/bold"))))


def _statement_candidates(root: ET.Element):
    """Free text of each element that may hold the statement, title left out, if it names a role."""
    for el in root.iter():
        if _holds_statement(el):
            text = " ".join(_text(child) for child in el if child.tag != "title")
            if find_roles(clean(text)):
                yield text


def parse_article(xml: bytes) -> Article:
    root = ET.fromstring(xml)
    meta = root.find("front/article-meta")
    if meta is None:
        raise ValueError("no front/article-meta")
    ids = {i.get("pub-id-type"): _text(i) for i in meta.findall("article-id")}
    years = [int(y) for y in (_text(d.find("year")) for d in meta.findall("pub-date")) if y.isdigit()]
    lic = meta.find("permissions/license")
    article = Article(
        pmcid=ids.get("pmcid") or (f"PMC{ids['pmc']}" if ids.get("pmc", "").isdigit() else ids.get("pmc")),
        article_type=root.get("article-type"),
        doi=ids.get("doi"),
        journal=_text(root.find("front/journal-meta/journal-title-group/journal-title")) or None,
        issn=[_text(i) for i in root.findall("front/journal-meta/issn") if _text(i)],
        publisher=_text(root.find("front/journal-meta/publisher/publisher-name")) or None,
        year=min(years) if years else None,
        license=(lic.get(f"{XLINK}href") or _text(lic.find(f"{ALI}license_ref")) or None) if lic is not None else None,
    )

    # Springer Nature and Frontiers leave contrib-type out; editors and reviewers carry one, or sit in a
    # contrib-group marked as theirs (eLife).
    contribs = [
        c
        for group in meta.iter("contrib-group")
        if group.get("content-type", "author") in {"author", "authors"}
        for c in group.findall("contrib")
        if c.get("contrib-type", "author") == "author"
    ]
    article.authors = [_author(c) for c in contribs]
    fns = {
        fn.get("id", ""): _text(fn)
        for fn in root.iter("fn")
        if fn.get("fn-type") == "con" or _CON_ID_RE.fullmatch(fn.get("id", ""))
    }
    per_author = [_contrib_roles(c, fns) for c in contribs]
    # Older eLife: one <fn id="conN"> per author, in author order, with no link from the author.
    if not any(found for found, _ in per_author) and len(fns) == len(contribs) and all(map(_CON_ID_RE.fullmatch, fns)):
        ordered = [t for _, t in sorted(fns.items(), key=lambda kv: int(kv[0][3:]))]
        per_author = [([("contrib_text", s) for _, _, s in find_roles(clean(t))], [t]) for t in ordered]
    tagged = [(i, style, slug) for i, (found, _) in enumerate(per_author) for style, slug in found]
    if tagged:
        article.style = min((style for _, style, _ in tagged), key=STYLES.index)
        article.assignments = {(i, slug) for i, style, slug in tagged if style == article.style}
        if article.style == "contrib_text":
            article.statement = "; ".join(
                f"{i + 1}. {article.authors[i].name}: {' '.join(texts)}"
                for i, (_, texts) in enumerate(per_author)
                if texts
            )
        return article

    # The first statement that names a role is kept even when it does not parse: those are the hard
    # cases the labelled set needs.
    for text in _statement_candidates(root):
        parsed = parse_statement(text, article.authors)
        article.statement, article.unresolved = text, parsed.unresolved
        if parsed.assignments:
            article.style, article.assignments = "statement_text", parsed.assignments
        break
    return article
