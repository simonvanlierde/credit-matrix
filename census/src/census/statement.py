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
import unicodedata
from bisect import bisect_left
from dataclasses import dataclass, field
from functools import lru_cache
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


_PARTICLE_RE = re.compile(r"d[aeiou]s?|del(?:la)?|der|la|le|te[nr]|v[ao]n")  # "da", "dos", "van", ...

type Parts = tuple[str, ...]


@lru_cache(maxsize=4096)
def _name_parts(author: Author) -> tuple[Parts, Parts, Parts, Parts]:
    """Given-name parts, surname parts without lower-case particles ("de", "van" rarely get an initial
    of their own), every surname word, and the surname without particles in any case ("De Luca")."""
    given = tuple(p for p in re.split(r"[\s.-]+", author.given) if p)
    words = tuple(p for p in re.split(r"[\s-]+", author.surname) if p)
    surname = tuple(p for p in words if not p.islower())
    core = tuple(p for p in words if not _PARTICLE_RE.fullmatch(p.casefold()))
    return given, surname, words, core


# Đ has no decomposition; Vietnamese statements write it as D, like Á as A.
_UNMARKED = str.maketrans("Đđ", "Dd")


def _fold(text: str) -> str:
    """`text` without diacritics: initials often drop them ("N.N.A." for Nguyễn Ngọc Ánh, "A.A.-A." for Ángel
    Arias-Arias)."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).translate(_UNMARKED)


@lru_cache(maxsize=4096)
def _folded_parts(author: Author) -> tuple[Parts, Parts, Parts, Parts]:
    given, surname, words, core = (tuple(_fold(p) for p in parts) for parts in _name_parts(author))
    return given, surname, words, core


def _fits(chunks: list[str], parts: Parts) -> bool:
    return len(chunks) == len(parts) and all(
        p.casefold().startswith(c.casefold()) for c, p in zip(chunks, parts, strict=True)
    )


def _fits_loosely(chunks: list[str], given: Parts, surname: Parts) -> bool:
    """Initials for a given name written as one word: "Q.M. Li" for Qinming Li."""
    head, tail = chunks[: -len(surname) or None], chunks[-len(surname) :]
    if not head or not surname or not _fits(tail, surname):
        return False
    rest = "".join(given).casefold()
    if not rest.startswith(head[0].casefold()):
        return False
    pos = len(head[0])
    for chunk in head[1:]:
        pos = rest.find(chunk.casefold(), pos)
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
    name only, a one-word given name; then particles as lower-case initials ("JvdB" for Jan van der
    Berg), the surname without particles ("CL" for Chiara De Luca), and the first of two surnames ("JG"
    for José García López). The first order any author fits decides, so "L.H." is Liang Hong even when
    Hao Leng fits surname-first.
    """
    chunks = _chunks(token)
    if not chunks:
        return None
    # Without diacritics only when no author fits as written: folded, "ŞY" for Şilan Yavuz fits Sema Y. too.
    hits = _hits(chunks, [_name_parts(a) for a in authors]) or _hits(
        [_fold(c) for c in chunks], [_folded_parts(a) for a in authors]
    )
    return hits[0] if len(hits) == 1 else None


def _hits(chunks: list[str], parts: list[tuple[Parts, Parts, Parts, Parts]]) -> list[int]:
    """Authors fitting the first order in `resolve_initials` that any author fits."""
    letters = "".join(chunks)
    tiers = (
        lambda g, s, w, c: _fits(chunks, g + s),
        lambda g, s, w, c: _fits(chunks, s + g),
        lambda g, s, w, c: _fits(chunks, g[:1] + s),
        lambda g, s, w, c: _fits_loosely(chunks, g, s),
        lambda g, s, w, c: letters == "".join(p[0] for p in g + w),
        lambda g, s, w, c: _fits(chunks, g + c),
        lambda g, s, w, c: _fits(chunks, g + c[:1]) or _fits(chunks, g[:1] + c[:1]),
    )
    for fits in tiers:
        if hits := [i for i, p in enumerate(parts) if fits(*p)]:
            return hits
    return []


def _mask(text: str, start: int, end: int) -> str:
    return text[:start] + " " * (end - start) + text[end:]


def _name_variants(author: Author) -> tuple[set[str], set[str]]:
    """Full names, matched in any case: "Ann Smith", "Smith Ann", "Smith, Ann". And initials forms,
    matched as written: Vancouver style "Smith AB" / "Smith A.B." / "Smith, A.B.", initials first
    "AB Smith" / "A.B. Smith" (Life Science Alliance), and hyphenated given names as "Kim J-H" or
    "J.-H. Kim"."""
    surname, given = author.surname, author.given
    if not surname:
        return set(), set()
    names = {author.name, f"{surname} {given}", f"{surname}, {given}"} if given else {surname}
    initials = "".join(g[0] for g in _name_parts(author)[0])
    hyphened = ["-".join(p[0] for p in word.split("-") if p) for word in given.split()]
    dotted = "".join(f"{h.replace('-', '.-')}." for h in hyphened)
    forms = {initials, f"{'.'.join(initials)}.", "".join(hyphened), dotted}
    short = {v for f in forms if f.strip(".") for v in (f"{surname} {f}", f"{surname}, {f}", f"{f} {surname}")}
    return {clean(v) for v in names}, {clean(v) for v in short}


_AFTER_INITIAL_RE = re.compile(rf"(?<!\w){_U}(?:\.|\.? - )$")
# A clause opening with a name the parser did not recognise: "Dunn, C: writing".
_NAME_COLON_RE = re.compile(rf"{_U}[^:;]*:\s*$")


def _bounded(text: str, start: int, end: int) -> bool:
    """No word character on either side of text[start:end], nor an initial and a dot or dash before it:
    "M. Li" is not inside "X.M. Li" or "X. - M. Li"."""
    return (
        (not start or not (text[start - 1].isalnum() or text[start - 1] == "_"))
        and not _AFTER_INITIAL_RE.search(text, max(0, start - 6), start)
        and (end == len(text) or not (text[end].isalnum() or text[end] == "_"))
    )


def _find(hay: str, needle: str, text: str):
    """Start of each occurrence of `needle` in `hay` (`text` or its `_lower`) bounded in `text`, left to
    right without overlaps."""
    start = hay.find(needle)
    while start >= 0:
        end = start + len(needle)
        if _bounded(text, start, end):
            yield start
            start = hay.find(needle, end)
        else:
            start = hay.find(needle, start + 1)


def _lower(text: str) -> str:
    """Lower case of the same length, so positions carry over: the few characters that lower to two keep
    the first ("İ" to "i")."""
    lower = text.lower()
    return lower if len(lower) == len(text) else "".join(c.lower()[0] for c in text)


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
        # unless a comma, semicolon or "and" joins the two authors ("C.D. and E.F.").
        joined = re.search(r"[,;]|\band\b", gap)
        if kind == "A" and "." in gap and ":" not in gap and (next_kind == "R" or not joined):
            ends.append(end)
    kept: list[int] = []
    for pos in sorted(ends):
        if not _joins(text, ordered, kept[-1] if kept else 0, pos):
            kept.append(pos)
    return kept


def _joins(text: str, ordered: list[tuple[int, int, str, int | str]], start: int, pos: int) -> bool:
    """Whether the end at `pos` falls inside one clause after all, given the clause so far from `start`:
    a semicolon inside a list of authors ("T.A.R.-L., C.O.-P.; J.M.G.-R.: software"), or the full stop
    between a clause of roles and the initials that close it ("Investigation, methodology. S.H.;")."""
    if text[pos] == ";":
        following = next((kind for s, _, kind, _ in ordered if s > pos), None)
        return following == "A" and _only_authors(text, ordered, start + 1 if start else 0, pos)
    if text[pos] != "." or {kind for s, _, kind, _ in ordered if start <= s < pos} != {"R"}:
        return False
    stop = len(text) if (stop := text.find(";", pos)) < 0 else stop
    # Only resolved initials close it: "editing. Sarah Macek;" or "MD;" opens the next clause.
    return _only_authors(text, ordered, pos + 1, stop) and all(
        value not in (UNRESOLVED, ALL_AUTHORS) and _INITIALS_RE.fullmatch(text[s:e])
        for s, e, _, value in ordered
        if pos < s < stop
    )


def _only_authors(text: str, ordered: list[tuple[int, int, str, int | str]], start: int, stop: int) -> bool:
    """Whether text[start:stop] names authors and holds nothing else but commas, "and", full stops and spaces:
    "S.A.D. and M.R. conceptualized the project;" or "Funding was acquired by H.-J.L." is a sentence."""
    spans = [(s, e) for s, e, _, _ in ordered if start <= s < stop]
    if not spans or any(kind != "A" for s, _, kind, _ in ordered if start <= s < stop):
        return False
    rest = [text[e:s] for (_, e), (s, _) in pairwise([(start, start), *spans, (stop, stop)])]
    return all(re.fullmatch(r"(?:[\s.,]|\band\b)*", r) for r in rest)


def parse_statement(text: str, authors: list[Author]) -> Parsed:
    """Role assignments in a free-text statement. Author indices refer to `authors`."""
    original = _APPROVAL_RE.sub(lambda m: " " * len(m.group()), clean(text))
    text = original
    parsed = Parsed()
    mentions: list[tuple[int, int, str, int | str]] = [(s, e, "R", slug) for s, e, slug in find_roles(text)]
    # Mask roles so their capitals ("Writing") are not read as initials.
    for start, end, _, _ in mentions:
        text = _mask(text, start, end)

    # Each spelling maps to every author it fits; one two authors share stays unresolved. Longest first,
    # and "Surname, Given" forms last, so they cannot take a name out of a list: "Ann Lee, Bo Wu".
    variants: dict[tuple[str, bool], set[int]] = {}
    for i, a in enumerate(authors):
        names, short = _name_variants(a)
        for v in names:
            variants.setdefault((_lower(v), True) if " " in v else (v, False), set()).add(i)
        for v in short:
            variants.setdefault((v, False), set()).add(i)
    lower = _lower(text)
    for (needle, any_case), hits in sorted(variants.items(), key=lambda kv: ("," in kv[0][0], -len(kv[0][0]), kv[0])):
        for start in list(_find(lower if any_case else text, needle, text)):
            end = start + len(needle)
            if len(hits) == 1:
                mentions.append((start, end, "A", next(iter(hits))))
            else:
                mentions.append((start, end, "A", UNRESOLVED))
                parsed.unresolved.append(text[start:end])
            text, lower = _mask(text, start, end), _mask(lower, start, end)
    for m in _ALL_RE.finditer(text):
        mentions.append((m.start(), m.end(), "A", ALL_AUTHORS))
        text = _mask(text, m.start(), m.end())
    resolved: dict[str, int | None] = {}  # role-first statements repeat each author's initials per role
    for m in _INITIALS_RE.finditer(text):
        token = m.group().strip()
        if not token[0].isupper():
            continue
        if token not in resolved:
            resolved[token] = resolve_initials(token, authors)
        i = resolved[token]
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
    for k, clause in sorted(clauses.items()):
        runs: list[tuple[str, list[int | str]]] = []
        for _, kind, value in clause:
            if runs and runs[-1][0] == kind:
                runs[-1][1].append(value)
            else:
                runs.append((kind, [value]))
        # "A.B.: conceptualization; methodology": a clause of roles alone goes to the people before it,
        # unless it opens with a name the parser did not recognise.
        lead_in = text[ends[k - 1] if k else 0 : clause[0][0]]  # names found are masked
        if [kind for kind, _ in runs] == ["R"] and previous_people and not _NAME_COLON_RE.search(lead_in):
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
