"""The 14 CRediT roles, keyed by the slug in their credit.niso.org URL, and how free text names them."""

import re

# Slug -> regex for the wording publishers use, matched case-insensitively on `clean`ed text. Only
# CRediT wording counts: "conceived the study" or "data analysis" stay unmatched, so prose statements
# show up as unparsed rather than guessed.
ROLE_PATTERNS: dict[str, str] = {
    "conceptualization": r"conceptuali[sz]ation",
    "data-curation": r"data curation",
    "formal-analysis": r"formal analys[ie]s",
    "funding-acquisition": r"funding acquisition",
    "investigation": r"investigation",
    "methodology": r"methodology",
    "project-administration": r"project administration",
    "resources": r"resources",
    "software": r"software",
    "supervision": r"supervision",
    "validation": r"validation",
    "visualization": r"visuali[sz]ation",
    "writing-original-draft": r"(?:writing ?- ?)?original draft(?: preparation)?",
    "writing-review-editing": r"(?:writing ?- ?)?review(?:ing)? and edit(?:ing)?",
}

ROLE_RE = re.compile(
    "|".join(rf"(?P<{slug.replace('-', '_')}>\b{pattern}\b)" for slug, pattern in ROLE_PATTERNS.items()),
    re.IGNORECASE,
)

_URL_RE = re.compile(r"credit\.niso\.org/contributor-roles/([a-z-]+)")
_DASHES = re.compile("\\s*[\\u2010-\\u2015\\u2212-]+\\s*")  # hyphen to horizontal bar, minus, ASCII hyphen


def clean(text: str) -> str:
    """One kind of dash, single spaces, "&" as "and". Keeps case, which initials need."""
    text = _DASHES.sub(" - ", text.replace("&", " and "))
    return re.sub(r"\s+", " ", text).strip()


def slug_from_url(url: str) -> str | None:
    """The role slug in a credit.niso.org role URL, or None for anything else."""
    match = _URL_RE.search(url)
    return match.group(1) if match and match.group(1) in ROLE_PATTERNS else None


def find_roles(text: str) -> list[tuple[int, int, str]]:
    """(start, end, slug) for each role named in `clean`ed text, in order."""
    return [(m.start(), m.end(), m.lastgroup.replace("_", "-")) for m in ROLE_RE.finditer(text) if m.lastgroup]
