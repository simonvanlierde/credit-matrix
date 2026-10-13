from observatory.roles import ROLE_PATTERNS, clean, find_roles, slug_from_url
from observatory.statement import Author, parse_statement, resolve_initials

AUTHORS = [
    Author("Anna", "Peters"),
    Author("Nils", "Zandvoort"),
    Author("Li-Jun", "Zhao"),
    Author("Qinming", "Li"),
    Author("Yibo", "Lu"),
    Author("Yang", "Lin"),
]


def roles_of(parsed, i):
    return {slug for j, slug in parsed.assignments if j == i}


def test_role_wording_variants():
    text = clean("Writing—Original Draft Preparation, writing - review & editing, Conceptualisation")
    assert [slug for _, _, slug in find_roles(text)] == [
        "writing-original-draft",
        "writing-review-editing",
        "conceptualization",
    ]


def test_slug_from_url_accepts_http_and_rejects_unknown():
    assert slug_from_url("http://credit.niso.org/contributor-roles/data-curation/") == "data-curation"
    assert slug_from_url("https://credit.niso.org/contributor-roles/made-up/") is None
    assert len(ROLE_PATTERNS) == 14


def test_author_first_with_initials():
    parsed = parse_statement("AP: conceptualization, methodology; NZ, L.-J.Z.: writing – original draft.", AUTHORS)
    assert roles_of(parsed, 0) == {"conceptualization", "methodology"}
    assert roles_of(parsed, 1) == roles_of(parsed, 2) == {"writing-original-draft"}


def test_role_first_ignores_closing_approval_sentence():
    text = (
        "Conceptualization, A.P. and N.Z.; Methodology, A.P.; Supervision, N.Z. "
        "All authors have read and agreed to the published version of the manuscript."
    )
    parsed = parse_statement(text, AUTHORS)
    assert roles_of(parsed, 0) == {"conceptualization", "methodology"}
    assert roles_of(parsed, 1) == {"conceptualization", "supervision"}
    assert not roles_of(parsed, 2)


def test_full_names_and_all_authors():
    parsed = parse_statement(
        "Anna Peters: Software. Nils Zandvoort: Validation. All authors: Writing – review & editing.", AUTHORS
    )
    assert roles_of(parsed, 0) == {"software", "writing-review-editing"}
    assert roles_of(parsed, 5) == {"writing-review-editing"}


def test_initials_resolution():
    assert resolve_initials("AP", AUTHORS) == 0
    assert resolve_initials("L.J.Z.", AUTHORS) == 2
    assert resolve_initials("Q.M.L.", AUTHORS) == 3  # one-word given name
    assert resolve_initials("YiL", AUTHORS) == 4  # Frontiers adds letters to tell authors apart
    assert resolve_initials("YL", AUTHORS) is None  # Yibo Lu and Yang Lin
    assert resolve_initials("XX", AUTHORS) is None


def test_ambiguous_initials_are_reported_not_guessed():
    parsed = parse_statement("YL: software; AP: validation.", AUTHORS)
    assert parsed.unresolved == ["YL"]
    assert parsed.assignments == {(0, "validation")}


def test_prose_yields_nothing():
    parsed = parse_statement("A.P. conceived the study and N.Z. wrote the paper.", AUTHORS)
    assert parsed.assignments == set()


def test_all_authors_contributing_is_an_assignment():
    text = "All authors contributed to the investigation and conceptualization. All authors read and approved the manuscript."
    parsed = parse_statement(text, AUTHORS[:2])
    assert parsed.assignments == {(i, r) for i in (0, 1) for r in ("investigation", "conceptualization")}
