"""Rule-based parser for free-text CRediT statements, matched against the article's author list.

Handles the two layouts publishers use, whatever the punctuation:

- author first: "AP: conceptualization, methodology; NZ, LS: writing - original draft."
- role first (MDPI): "Conceptualization, A.B. and C.D.; Methodology, A.B."

It finds every author mention (full name, surname plus initials, or initials resolved against the
author list) and every role name, splits the text into clauses, and within each clause groups
neighbours of the same kind into runs and pairs each run of the kind that comes first with the run
that follows it. Working per clause keeps a clause with no CRediT wording ("CD: drew the figures")
from shifting the pairs after it. Prose ("A.B. conceived the study") names no CRediT role, so it
yields nothing rather than a guess.
"""

import re
from bisect import bisect_left
from dataclasses import dataclass, field
from itertools import pairwise

from census.roles import clean, find_roles


@dataclass(frozen=True)
class Author:
    given: str
    surname: str
    orcid: str | None = None

    @property
    def name(self) -> str:
        return f"{self.given} {self.surname}".strip()


@dataclass
class Parsed:
    assignments: set[tuple[int, str]] = field(default_factory=set)
    """(author index, role slug) pairs."""
    unresolved: list[str] = field(default_factory=list)
    """Initials-like tokens that matched no author, or more than one."""


ALL_AUTHORS = -1
UNRESOLVED = -2
"""Holds an unresolved author's place, so the roles next to it are not paired with a neighbour."""

# Initials such as "AP", "Q.M.L.", "H.Š.", "YiL" (Frontiers adds letters to tell authors apart), "L. - J. Z.".
# A capital is any letter but a-z (Python's re has no Unicode-category classes); tokens that start
# lower-case are skipped later. A space after a dot only continues the token before another initial
# with a dot, so "EF. AB is the guarantor" stops at "EF.".
_U = r"[^\W\d_a-z]"
# Lower-case particles between dots ("F.d.S.N." for Fernanda da Silva Nunes) belong to the token.
_PARTICLES = r"(?:\.[a-z](?=\.))*"
_INITIALS_RE = re.compile(
    rf"(?<![\w.]){_U}[a-z]{{0,2}}{_PARTICLES}"
    rf"(?:(?:\.(?! )|\. (?={_U}\.)|\.? - )?{_U}[a-z]{{0,2}}{_PARTICLES}){{0,5}}\.?(?!\w)"
)
_ALL_RE = re.compile(r"\ball (?:the )?(?:other )?authors\b", re.IGNORECASE)
# The closing "All authors read and approved the manuscript." is not a role assignment. "All authors
# contributed to the investigation" is, so only approval wording is dropped.
_APPROVAL_RE = re.compile(
    r"\ball (?:the )?authors (?:have |has )?(?:read|approved|agreed|critically reviewed|reviewed and approved|gave)"
    r"[^;]*?(?:\.(?=\s|$)|;|$)",
    re.IGNORECASE,
)


def _name_parts(author: Author) -> tuple[list[str], list[str]]:
    given = [p for p in re.split(r"[\s.-]+", author.given) if p]
    # Lower-case particles ("de", "van") rarely get an initial of their own.
    surname = [p for p in re.split(r"[\s-]+", author.surname) if p and not p.islower()]
    return given, surname


def _fits(chunks: list[str], parts: list[str]) -> bool:
    return len(chunks) == len(parts) and all(
        p.lower().startswith(c.lower()) for c, p in zip(chunks, parts, strict=True)
    )


def _fits_loosely(chunks: list[str], given: list[str], surname: list[str]) -> bool:
    """Initials for a given name written as one word: "Q.M. Li" for Qinming Li."""
    head, tail = chunks[: -len(surname) or None], chunks[-len(surname) :]
    if not head or not surname or not _fits(tail, surname):
        return False
    rest = "".join(given).lower()
    if not rest.startswith(head[0].lower()):
        return False
    pos = len(head[0])
    for chunk in head[1:]:
        pos = rest.find(chunk.lower(), pos)
        if pos < 0:
            return False
        pos += len(chunk)
    return True


def _chunks(token: str) -> list[str]:
    """ "YiL" -> ["Yi", "L"], "Q.M.L." -> ["Q", "M", "L"]: a new chunk at each capital."""
    chunks: list[str] = []
    for ch in re.sub(r"(?<=\.)[a-z](?=\.)", "", token):  # drop particles: "F.d.S.N." -> F, S, N
        if ch.isalpha():
            if ch.isupper() or not chunks:
                chunks.append(ch)
            else:
                chunks[-1] += ch
    return chunks


def resolve_initials(token: str, authors: list[Author]) -> int | None:
    """Index of the one author whose initials `token` spells, or None if none or several do.

    Orders are tried in turn, most usual first: given then surname, surname then given, first given
    name only, a one-word given name. The first order any author fits decides, so "L.H." is Liang Hong
    even when Hao Leng fits surname-first.
    """
    chunks = _chunks(token)
    if not chunks:
        return None
    parts = [_name_parts(a) for a in authors]
    tiers = (
        lambda g, s: _fits(chunks, g + s),
        lambda g, s: _fits(chunks, s + g),
        lambda g, s: _fits(chunks, g[:1] + s),
        lambda g, s: _fits_loosely(chunks, g, s),
    )
    for fits in tiers:
        hits = [i for i, (g, s) in enumerate(parts) if fits(g, s)]
        if hits:
            return hits[0] if len(hits) == 1 else None
    return None


def _mask(text: str, start: int, end: int) -> str:
    return text[:start] + " " * (end - start) + text[end:]


def _name_variants(author: Author) -> set[str]:
    """Full-name spellings: "Ann Smith", "Smith Ann", Vancouver style "Smith AB" / "Smith A.B.", and
    initials first, "AB Smith" / "A.B. Smith" (Life Science Alliance)."""
    if not author.surname:
        return set()
    given, _ = _name_parts(author)
    initials = "".join(g[0] for g in given)
    variants = {author.name, f"{author.surname} {author.given}"}
    if initials:
        dotted = f"{'.'.join(initials)}."
        variants |= {f"{author.surname} {initials}", f"{author.surname} {dotted}"}
        variants |= {f"{initials} {author.surname}", f"{dotted} {author.surname}"}
    return {clean(v) for v in variants if v.strip()}


def _clause_ends(text: str, mentions: list[tuple[int, int, str, int | str]]) -> list[int]:
    """Positions where one assignment clause ends: a semicolon; a full stop after a lower-case word
    ("draft. NZ:"); and a full stop after an author ("Nam KC. Data curation", "A.B. Methodology",
    "EF. AB is the guarantor"), but not "C.D.: writing", where the colon ties the author to the roles
    after it."""
    ends = [m.start() for m in re.finditer(";", text)]
    for m in re.finditer(r"\.(?=\s|$)", text):
        before = text[m.start() - 1] if m.start() else ""
        if before.islower() or before in ")]":
            ends.append(m.start())
    ordered = sorted(mentions)
    for (_, end, kind, _), (start, _, next_kind, _) in pairwise(ordered):
        gap = text[end - 1 : start]
        # "A.B. Methodology" ends a role-first clause; "EF. AB is the guarantor" starts a new sentence,
        # unless a comma or "and" joins the two authors ("C.D. and E.F.").
        joined = re.search(r",|\band\b", gap)
        if kind == "A" and "." in gap and ":" not in gap and (next_kind == "R" or not joined):
            ends.append(end)
    return sorted(ends)


def parse_statement(text: str, authors: list[Author]) -> Parsed:
    """Role assignments in a free-text statement. Author indices refer to `authors`."""
    original = _APPROVAL_RE.sub(lambda m: " " * len(m.group()), clean(text))
    text = original
    parsed = Parsed()
    mentions: list[tuple[int, int, str, int | str]] = [(s, e, "R", slug) for s, e, slug in find_roles(text)]
    # Mask roles so their capitals ("Writing") are not read as initials.
    for start, end, _, _ in mentions:
        text = _mask(text, start, end)

    full_names = sorted(((v, i) for i, a in enumerate(authors) for v in _name_variants(a)), key=lambda p: -len(p[0]))
    for variant, i in full_names:
        for m in re.finditer(rf"(?<!\w){re.escape(variant)}(?!\w)", text):
            mentions.append((m.start(), m.end(), "A", i))
            text = _mask(text, m.start(), m.end())
    for m in _ALL_RE.finditer(text):
        mentions.append((m.start(), m.end(), "A", ALL_AUTHORS))
        text = _mask(text, m.start(), m.end())
    for m in _INITIALS_RE.finditer(text):
        token = m.group().strip()
        if not token[0].isupper():
            continue
        i = resolve_initials(token, authors)
        if i is not None:
            mentions.append((m.start(), m.end(), "A", i))
        elif sum(c.isupper() for c in token) >= 2:
            mentions.append((m.start(), m.end(), "A", UNRESOLVED))
            parsed.unresolved.append(token)

    ends = _clause_ends(original, mentions)
    clauses: dict[int, list[tuple[int, str, int | str]]] = {}
    for start, _, kind, value in sorted(mentions):
        clauses.setdefault(bisect_left(ends, start), []).append((start, kind, value))

    previous_people: list[int | str] = []
    for _, clause in sorted(clauses.items()):
        runs: list[tuple[str, list[int | str]]] = []
        for _, kind, value in clause:
            if runs and runs[-1][0] == kind:
                runs[-1][1].append(value)
            else:
                runs.append((kind, [value]))
        # "A.B.: conceptualization; methodology": a clause of roles alone goes to the people before it.
        if [kind for kind, _ in runs] == ["R"] and previous_people:
            runs.insert(0, ("A", previous_people))
        # A trailing run with no partner (authors named after the last roles) is dropped by zip.
        for lead, follow in zip(runs[::2], runs[1::2], strict=False):
            people, slugs = (lead[1], follow[1]) if lead[0] == "A" else (follow[1], lead[1])
            indices = range(len(authors)) if ALL_AUTHORS in people else [int(i) for i in people if i != UNRESOLVED]
            parsed.assignments |= {(i, str(s)) for i in indices for s in slugs}
        people_runs = [values for kind, values in runs if kind == "A"]
        if people_runs:
            previous_people = people_runs[-1]
    return parsed
