"""Rule-based parser for free-text CRediT statements, matched against the article's author list.

Handles the two layouts publishers use, whatever the punctuation:

- author first: "AP: conceptualization, methodology; NZ, LS: writing - original draft."
- role first (MDPI): "Conceptualization, A.B. and C.D.; Methodology, A.B."

It finds every author mention (full name, or initials resolved against the author list) and every
role name, in text order, groups neighbours of the same kind into runs, and pairs each run of the
kind that comes first with the run that follows it. Prose ("A.B. conceived the study") names no
CRediT role, so it yields nothing rather than a guess.
"""

import re
from dataclasses import dataclass, field

from observatory.roles import clean, find_roles


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

# Initials such as "AP", "Q.M.L.", "YiL" (Frontiers adds letters to tell authors apart), "L. - J. Z."
_INITIALS_RE = re.compile(r"(?<![\w.])(?:[A-Z][a-z]{0,2}(?:\.? - |\. ?)?){1,5}(?!\w)")
_ALL_RE = re.compile(r"\ball (?:the )?(?:other )?authors\b", re.IGNORECASE)
# The closing "All authors read and approved the manuscript." is not a role assignment.
_APPROVAL_RE = re.compile(
    r"\ball (?:the )?authors (?:have |has )?(?:read|approved|agreed|reviewed|contributed|gave|discussed)"
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


def resolve_initials(token: str, authors: list[Author]) -> int | None:
    """Index of the one author whose initials `token` spells, or None if none or several do."""
    chunks = re.findall(r"[A-Z][a-z]*", token)
    if not chunks:
        return None
    parts = [_name_parts(a) for a in authors]
    hits = [i for i, (g, s) in enumerate(parts) if any(_fits(chunks, o) for o in (g + s, s + g, g[:1] + s))]
    if not hits:
        hits = [i for i, (g, s) in enumerate(parts) if _fits_loosely(chunks, g, s)]
    return hits[0] if len(hits) == 1 else None


def _mask(text: str, start: int, end: int) -> str:
    return text[:start] + " " * (end - start) + text[end:]


def parse_statement(text: str, authors: list[Author]) -> Parsed:
    """Role assignments in a free-text statement. Author indices refer to `authors`."""
    text = _APPROVAL_RE.sub(lambda m: " " * len(m.group()), clean(text))
    parsed = Parsed()
    roles = find_roles(text)
    mentions: list[tuple[int, str, int | str]] = [(s, "R", slug) for s, _, slug in roles]
    # Mask roles so their capitals ("Writing") are not read as initials.
    for start, end, _ in roles:
        text = _mask(text, start, end)

    full_names = sorted(
        ((clean(v), i) for i, a in enumerate(authors) for v in {a.name, f"{a.surname} {a.given}"} if a.surname),
        key=lambda pair: -len(pair[0]),
    )
    for variant, i in full_names:
        for m in re.finditer(rf"(?<!\w){re.escape(variant)}(?!\w)", text):
            mentions.append((m.start(), "A", i))
            text = _mask(text, m.start(), m.end())
    for m in _ALL_RE.finditer(text):
        mentions.append((m.start(), "A", ALL_AUTHORS))
        text = _mask(text, m.start(), m.end())
    for m in _INITIALS_RE.finditer(text):
        token = m.group().strip()
        i = resolve_initials(token, authors)
        if i is not None:
            mentions.append((m.start(), "A", i))
        elif sum(c.isupper() for c in token) >= 2:
            mentions.append((m.start(), "A", UNRESOLVED))
            parsed.unresolved.append(token)

    runs: list[tuple[str, list[int | str]]] = []
    for _, kind, value in sorted(mentions, key=lambda m: m[0]):
        if runs and runs[-1][0] == kind:
            runs[-1][1].append(value)
        else:
            runs.append((kind, [value]))
    # A trailing run with no partner (authors named after the last roles) is dropped by zip.
    for lead, follow in zip(runs[::2], runs[1::2], strict=False):
        people, slugs = (lead[1], follow[1]) if lead[0] == "A" else (follow[1], lead[1])
        indices = range(len(authors)) if ALL_AUTHORS in people else [int(i) for i in people if i != UNRESOLVED]
        parsed.assignments |= {(i, str(s)) for i in indices for s in slugs}
    return parsed
