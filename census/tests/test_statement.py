from census.roles import ROLE_PATTERNS, clean, find_roles, slug_from_url
from census.statement import Author, parse_statement, resolve_initials

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


THREE = [Author("Ann", "Bell"), Author("Carl", "Dunn"), Author("Eva", "Fox")]


def test_a_clause_without_credit_wording_does_not_shift_the_rest():
    parsed = parse_statement("AB: conceptualization. CD: drew the figures. EF: software.", THREE)
    assert parsed.assignments == {(0, "conceptualization"), (2, "software")}


def test_role_first_clauses_ended_by_full_stops():
    parsed = parse_statement("Conceptualization, A.B. Methodology, C.D. and E.F.", THREE)
    assert parsed.assignments == {(0, "conceptualization"), (1, "methodology"), (2, "methodology")}


def test_a_clause_of_roles_alone_goes_to_the_people_before_it():
    parsed = parse_statement("A.B.: conceptualization; methodology. C.D.: software.", THREE)
    assert parsed.assignments == {(0, "conceptualization"), (0, "methodology"), (1, "software")}


def test_initials_stop_at_a_sentence_end():
    parsed = parse_statement("Supervision: EF. AB is the guarantor.", THREE)
    assert parsed.assignments == {(2, "supervision")}


def test_vancouver_surname_and_initials():
    authors = [Author("Ki Chang", "Nam"), Author("Dong Gyun", "Yim")]
    parsed = parse_statement("Conceptualization: Nam KC. Data curation: Yim DG.", authors)
    assert parsed.assignments == {(0, "conceptualization"), (1, "data-curation")}


def test_non_ascii_initials():
    authors = [Author("Hana", "Šigutová"), Author("Filip", "Harabiš")]
    parsed = parse_statement("Software: H.Š. and F.H.", authors)
    assert parsed.assignments == {(0, "software"), (1, "software")}


def test_given_name_first_wins_over_surname_first():
    authors = [Author("Hao", "Leng"), Author("Liang", "Hong")]
    assert resolve_initials("L.H.", authors) == 1


def test_particles_inside_initials():
    authors = [Author("Fernanda", "da Silva Nunes"), Author("João Antonio", "dos Santos-Silva")]
    parsed = parse_statement("Methodology, F.d.S.N. and J.A.d.S.-S.", authors)
    assert parsed.assignments == {(0, "methodology"), (1, "methodology")}
