"""Extract per-author CRediT roles from a JATS article, whichever markup the publisher used."""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from census.roles import clean, find_roles, names_credit, slug_from_url
from census.statement import Author, parse_statement

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

# "Author contributions", "CRediT authorship contribution statement", "Contributors", "Author statement",
# "Authorship"; not Frontiers' "Contribution to the field", nor a body section on "Green credit policy"
# or "Author gender".
_STATEMENT_TITLE_RE = re.compile(
    r"author'?s?'?\W+contribution|contributions? of (?:the )?authors|(?-i:\bCRediT\b)|contributor"
    r"|author\w*\W+statement|^\W*authorship\W*$",
    re.IGNORECASE,
)
# A bare "Contributions" outside the body: in the body it is the paper's own contribution.
_BARE_TITLE_RE = re.compile(r"^\W*contributions?\W*$", re.IGNORECASE)
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
    paired: set[tuple[int, str]] | None = None
    """For an article whose roles are tagged (jats4r, plos_uri) and that also prints a statement: what
    the statement parser reads from that statement. Scored against `assignments`, it measures the
    parser without hand labels."""


_ORCID_RE = re.compile(r"\d{4}-\d{4}-\d{4}-\d{3}[\dX]")


# UTF-8 bytes that were read as Latin-1 and encoded again: Europe PMC's bulk files store "—" as
# "â\x80\x94" and "ă" as "Ä\x83" in about two in three articles.
_MOJIBAKE_RE = re.compile("[\xc2-\xdf][\x80-\xbf]|[\xe0-\xef][\x80-\xbf]{2}|[\xf0-\xf4][\x80-\xbf]{3}")


def _repair(match: re.Match[str]) -> str:
    try:
        return match.group().encode("latin-1").decode("utf-8")
    except UnicodeDecodeError:
        return match.group()


def _squash(text: str) -> str:
    # Repair first: some continuation bytes are whitespace to Python ("\xa0" in "à", "\x85" in "Å").
    return re.sub(r"\s+", " ", _MOJIBAKE_RE.sub(_repair, text)).strip()


def _text(el: ET.Element | None) -> str:
    # Joined with spaces: list items, paragraphs and <break/> otherwise glue words ("analysisS.").
    return _squash(" ".join(el.itertext())) if el is not None else ""


def _own_text(el: ET.Element, skip: str) -> str:
    """Text of `el` without what sits inside its `skip` children (a consortium's member list)."""
    parts = [el.text or ""]
    for child in el:
        if child.tag != skip:
            parts.append(_text(child))
        parts.append(child.tail or "")
    return _squash(" ".join(parts))


def _author(contrib: ET.Element) -> Author:
    name = contrib.find("name")
    ids = (_ORCID_RE.search(_text(c)) for c in contrib.findall("contrib-id") if c.get("contrib-id-type") == "orcid")
    orcid = next((m.group() for m in ids if m), None)  # bare form: http and https URIs both occur
    if name is not None:
        return Author(_text(name.find("given-names")), _text(name.find("surname")), orcid)
    collab = contrib.find("collab")
    return Author(
        "", _own_text(collab, "contrib-group") if collab is not None else _text(contrib.find("string-name")), orcid
    )


def _contrib_roles(contrib: ET.Element, fns: dict[str, str]) -> tuple[list[tuple[str, str]], list[str]]:
    """(style, slug) for each role tagged on one author, and the free text it came from."""
    found, texts = [], []
    for role in contrib.findall("role"):
        url = role.get("vocab-term-identifier", "") if role.get("vocab") == "credit" else role.get("content-type", "")
        style = "jats4r" if role.get("vocab") == "credit" else "plos_uri"
        if style == "plos_uri" and not re.search(r"credit|casrai", url):
            texts.append(_text(role))
        elif slug := slug_from_url(url):
            found.append((style, slug))
        else:
            # A malformed role URL ("contributor-roles/formal analysis/", casrai.org): read the term,
            # the URL's last segment or the text, and keep the tagged style.
            fallback = " ".join([role.get("vocab-term", ""), url.rstrip("/").rsplit("/", 1)[-1], _text(role)])
            found += [(style, s) for s in {s for _, _, s in find_roles(clean(fallback))}]
    texts += [fns[rid] for x in contrib.findall("xref") if (rid := x.get("rid", "")) in fns]
    found += [("contrib_text", s) for t in texts for _, _, s in find_roles(clean(t))]
    return found, texts


def _holds_statement(el: ET.Element, in_body: bool) -> bool:
    if el.tag == "notes" and "contribution" in (el.get("notes-type") or ""):
        return True
    title = _text(el.find("title")) if el.tag in {"sec", "fn-group", "notes"} else ""
    if el.tag == "fn":  # BMJ: <fn><p><bold>Contributors:</bold> ...
        title = _text(el.find("p/bold"))
    return bool(_STATEMENT_TITLE_RE.search(title) or (not in_body and _BARE_TITLE_RE.search(title)))


def _statement_candidates(root: ET.Element):
    """Free text of each element that may hold the statement, title left out, if it names a role.

    Back matter first, so the author contributions note wins over anything in the body.
    """
    back, body = root.find("back"), root.find("body")
    in_body = {id(el) for el in body.iter()} if body is not None else set()
    seen: set[int] = set()
    for el in [*(back.iter() if back is not None else []), *root.iter()]:
        if id(el) in seen:
            continue
        seen.add(id(el))
        if _holds_statement(el, id(el) in in_body):
            text = " ".join(_text(child) for child in el if child.tag != "title")
            if find_roles(clean(text)):
                yield text


def parse_article(xml: bytes) -> Article:
    return parse_element(ET.fromstring(xml))


def parse_element(root: ET.Element) -> Article:
    """Parse one <article> element, as a bulk file's iterparse hands it over."""
    meta = root.find("front/article-meta")
    if meta is None:
        raise ValueError("no front/article-meta")
    ids = {i.get("pub-id-type"): _text(i) for i in meta.findall("article-id")}
    # A sane range keeps a mistyped year ("20225") out of an INTEGER column.
    years = [int(y) for y in (_text(d.find("year")) for d in meta.findall("pub-date")) if y.isdigit()]
    years = [y for y in years if 1900 <= y <= 2100]
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
    # Direct children only: a <collab> holds its own contrib-group of consortium members.
    contribs = [
        c
        for group in meta.findall("contrib-group")
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
        elif text := next(_statement_candidates(root), None):
            article.statement = text
            article.paired = parse_statement(text, article.authors).assignments
        return article

    # The first statement that names a role is kept even when it does not parse or is not CRediT:
    # those are the hard cases the labelled set needs.
    for text in _statement_candidates(root):
        parsed = parse_statement(text, article.authors)
        article.statement, article.unresolved = text, parsed.unresolved
        if parsed.assignments and names_credit(clean(text)):
            article.style, article.assignments = "statement_text", parsed.assignments
        break
    return article
