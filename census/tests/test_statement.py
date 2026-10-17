import pytest

from census.roles import ROLE_PATTERNS, clean, find_roles, names_credit, slug_from_url
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


def test_initials_before_surname():
    authors = [Author("Brendan James", "Houston"), Author("Duc", "Merriner")]
    parsed = parse_statement("BJ Houston: data curation. D. Merriner: software.", authors)
    assert parsed.assignments == {(0, "data-curation"), (1, "software")}


def test_initials_first_name_is_not_read_inside_hyphenated_initials():
    authors = [Author("Xiao-Ming", "Li"), Author("Ming", "Li")]
    parsed = parse_statement("X.-M. Li: software; M. Li: validation.", authors)
    assert parsed.assignments == {(0, "software"), (1, "validation")}
    parsed = parse_statement("X.M. Li: software; M. Li: validation.", [Author("Xiao Ming", "Li"), Author("Ming", "Li")])
    assert parsed.assignments == {(0, "software"), (1, "validation")}


@pytest.mark.parametrize(
    ("authors", "text", "unresolved"),
    [
        ([Author("Hong", "Wang"), Author("Wei", "Zhang"), Author("Hao", "Wang")], "H Wang: software", ["H Wang"]),
        (
            [Author("Li", "Wang"), Author("Wang", "Li")],
            "Li Wang: software. Wang Li: validation.",
            ["Li Wang", "Wang Li"],
        ),
    ],
)
def test_a_name_two_authors_share_stays_unresolved(authors, text, unresolved):
    parsed = parse_statement(text, authors)
    assert parsed.assignments == set()
    assert parsed.unresolved == unresolved


def test_surname_comma_initials():
    parsed = parse_statement("A.B.: software; Dunn, C: writing - review and editing", THREE)
    assert parsed.assignments == {(0, "software"), (1, "writing-review-editing")}
    parsed = parse_statement("Software: Bell, Ann, Fox, E.", THREE)
    assert parsed.assignments == {(0, "software"), (2, "software")}


def test_unknown_name_does_not_inherit_the_previous_authors_roles():
    parsed = parse_statement("A.B.: software; Dunne, C: writing - review and editing", THREE)
    assert parsed.assignments == {(0, "software")}


def test_surname_comma_given_does_not_split_a_list_of_names():
    authors = [Author("Ajaya", "Sharma"), Author("Monica", "Sharma")]
    parsed = parse_statement("Data curation: Ajaya Sharma, Monica Sharma.", authors)
    assert parsed.assignments == {(0, "data-curation"), (1, "data-curation")}


def test_hyphenated_given_names():
    authors = [Author("Jun-Ho", "Kim"), Author("Wei-Jie", "Zhang")]
    parsed = parse_statement("J.-H. Kim: software. Zhang W.-J.: validation.", authors)
    assert parsed.assignments == {(0, "software"), (1, "validation")}
    parsed = parse_statement("Software: Kim J-H and W.-J. Zhang.", authors)
    assert parsed.assignments == {(0, "software"), (1, "software")}


@pytest.mark.parametrize(
    ("token", "author"),
    [
        ("JvdB", Author("Jan", "van der Berg")),
        ("AdS", Author("Ana", "da Silva")),
        ("CL", Author("Chiara", "De Luca")),
        ("JG", Author("José", "García López")),
        ("ZL", Author("Li", "Zhao")),  # surname first
        ("L.Z.", Author("Li-Jun", "Zhao")),  # first given name only
    ],
)
def test_initials_tiers(token, author):
    assert resolve_initials(token, [Author("Ann", "Bell"), author]) == 1


def test_a_stricter_tier_wins_over_particles():
    assert resolve_initials("CL", [Author("Chiara", "De Luca"), Author("Carlo", "Lanza")]) == 1


def test_full_names_in_any_case():
    parsed = parse_statement("ISIK DEMIR: methodology. bo wu: software.", [Author("Isik", "Demir"), Author("Bo", "Wu")])
    assert parsed.assignments == {(0, "methodology"), (1, "software")}


@pytest.mark.parametrize(
    "text",
    [
        "Software, A.B. All authors read and approved the manuscript.",
        "A.B.: software. All authors have read and approved the final manuscript.",
    ],
)
def test_approval_sentence_is_dropped(text):
    assert parse_statement(text, THREE).assignments == {(0, "software")}


_WORDINGS = {
    "conceptualization": ["Conceptualization", "conceptualisation"],
    "data-curation": ["Data curation"],
    "formal-analysis": ["Formal analysis", "formal analyses"],
    "funding-acquisition": ["Funding acquisition"],
    "investigation": ["Investigation"],
    "methodology": ["Methodology"],
    "project-administration": ["Project administration"],
    "resources": ["Resources"],
    "software": ["Software"],
    "supervision": ["Supervision"],
    "validation": ["Validation"],
    "visualization": ["Visualization", "visualisation"],
    "writing-original-draft": ["Original draft", "original draft preparation"]
    + [f"Writing{d}original draft" for d in ("‐", "–", "—", "−", "-", " - ")],
    "writing-review-editing": ["review and edit", "Reviewing and editing", "review & editing"]
    + [f"Writing{d}review and editing" for d in ("‐", "–", "—", "−", "-", " - ")],
}


def test_every_role_has_wordings():
    assert set(_WORDINGS) == set(ROLE_PATTERNS)


@pytest.mark.parametrize(("slug", "wording"), [(s, w) for s, ws in _WORDINGS.items() for w in ws])
def test_role_wording(slug, wording):
    assert [s for _, _, s in find_roles(clean(f"AB: {wording}."))] == [slug]


@pytest.mark.parametrize(("slug", "wording"), [(s, ws[0]) for s, ws in _WORDINGS.items()])
def test_names_credit_only_for_distinctive_roles(slug, wording):
    common = {"investigation", "methodology", "resources", "software", "supervision", "validation"}
    assert names_credit(clean(wording)) is (slug not in common)
