import re
from pathlib import Path

import pytest
from helpers import article, contrib

from census.jats import parse_article
from census.roles import ROLE_PATTERNS


def test_role_slugs_match_the_app():
    ts = (Path(__file__).parents[2] / "src/core/credit-roles.ts").read_text()
    assert set(re.findall(r"contributor-roles/([a-z-]+)/", ts)) == set(ROLE_PATTERNS)


def test_plos_uri():
    a = parse_article(
        article(
            contrib(
                "Ann",
                "Smith",
                '<role content-type="http://credit.niso.org/contributor-roles/software/">Software</role>'
                '<contrib-id contrib-id-type="orcid">https://orcid.org/0000-0002-1825-0097</contrib-id>',
            )
        )
    )
    assert (a.style, a.assignments, a.year, a.doi) == ("plos_uri", {(0, "software")}, 2024, "10.1/x")
    assert a.authors[0].orcid == "0000-0002-1825-0097"  # stored bare
    assert a.license == "https://creativecommons.org/licenses/by/4.0/"


def test_jats4r_wins_over_free_text():
    a = parse_article(
        article(
            contrib(
                "Ann",
                "Smith",
                '<role vocab="credit" vocab-term-identifier="https://credit.niso.org/contributor-roles/validation/">'
                "Validation</role><role>Software</role>",
            )
        )
    )
    assert (a.style, a.assignments) == ("jats4r", {(0, "validation")})


def test_contrib_text_from_role_and_linked_footnote():
    a = parse_article(
        article(
            contrib("Ann", "Smith", "<role>Conceptualization, Writing – original draft</role>", attrs="")
            + contrib("Bo", "Jones", '<xref ref-type="fn" rid="con2"/>')
            + contrib("Ed", "Itor", "<role>Software</role>", attrs='contrib-type="editor"'),
            '<fn-group><fn fn-type="con" id="con2"><p>Data curation.</p></fn></fn-group>',
        )
    )
    assert a.style == "contrib_text"
    assert len(a.authors) == 2  # the editor is left out
    assert a.assignments == {(0, "conceptualization"), (0, "writing-original-draft"), (1, "data-curation")}


def test_unlinked_con_footnotes_map_by_author_order():
    editors = f'</contrib-group><contrib-group content-type="editor">{contrib("Ed", "Itor", attrs="")}'
    a = parse_article(
        article(
            contrib("Ann", "Smith") + contrib("Bo", "Jones") + editors,
            '<sec><title>Author contributions</title><fn-group><fn id="con2"><p>Validation.</p></fn>'
            '<fn id="con1"><p>Software, performed the assays.</p></fn></fn-group></sec>',
        )
    )
    assert (a.style, a.assignments) == ("contrib_text", {(0, "software"), (1, "validation")})


@pytest.mark.parametrize(
    "back",
    [
        '<notes notes-type="author-contribution"><p>A.S.: software; B.J.: visualization.</p></notes>',
        "<sec><title>CRediT authorship contribution statement</title><p>Ann Smith: Software. Bo Jones: Visualization.</p></sec>",
        "<fn-group><fn><p><bold>Contributors:</bold> AS: software. BJ: visualization.</p></fn></fn-group>",
    ],
)
def test_statement_text(back):
    a = parse_article(article(contrib("Ann", "Smith") + contrib("Bo", "Jones"), back))
    assert a.style == "statement_text"
    assert a.assignments == {(0, "software"), (1, "visualization")}
    assert a.statement


def test_unparsed_statement_is_kept():
    back = "<sec><title>Author contributions</title><p>Software and validation by the team.</p></sec>"
    a = parse_article(article(contrib("Ann", "Smith"), back))
    assert (a.style, a.assignments) == ("none", set())
    assert a.statement == "Software and validation by the team."


def test_contrib_text_keeps_its_source_text():
    a = parse_article(article(contrib("Ann", "Smith", "<role>Software, Validation</role>") + contrib("Bo", "Jones")))
    assert a.statement == "1: Software, Validation"  # positions, not names: the labelling CSV lists the authors


def test_contribution_to_the_field_is_not_a_statement():
    back = "<sec><title>Contribution to the field</title><p>AS: software.</p></sec>"
    a = parse_article(article(contrib("Ann", "Smith"), back))
    assert (a.style, a.statement) == ("none", None)


def test_consortium_members_are_not_authors():
    members = contrib("Mia", "Member") + contrib("Max", "Member")
    group = f"<contrib><collab>The Study Group<contrib-group>{members}</contrib-group></collab></contrib>"
    a = parse_article(article(contrib("Ann", "Smith") + group))
    assert [x.name for x in a.authors] == ["Ann Smith", "The Study Group"]


def test_malformed_role_url_keeps_its_style():
    roles = (
        '<role vocab="credit" vocab-term="Formal analysis" '
        'vocab-term-identifier="https://credit.niso.org/contributor-roles/formal analysis/">Formal analysis</role>'
        '<role vocab="credit" vocab-term-identifier="https://credit.niso.org/contributor-roles/software/">Software</role>'
    )
    a = parse_article(article(contrib("Ann", "Smith", roles)))
    assert (a.style, a.assignments) == ("jats4r", {(0, "formal-analysis"), (0, "software")})


def test_back_matter_statement_beats_a_body_contribution_section():
    xml = article(
        contrib("Ann", "Smith"),
        '<notes notes-type="author-contribution"><p>AS: software, visualization.</p></notes>',
    ).replace(b"</front>", b"</front><body><sec><title>Contribution</title><p>Software matters.</p></sec></body>")
    a = parse_article(xml)
    assert (a.style, a.assignments) == ("statement_text", {(0, "software"), (0, "visualization")})


def test_list_items_are_not_glued_together():
    back = (
        "<sec><title>Author contributions</title><list><list-item><p>AS: formal analysis</p></list-item>"
        "<list-item><p>BJ: software</p></list-item></list></sec>"
    )
    a = parse_article(article(contrib("Ann", "Smith") + contrib("Bo", "Jones"), back))
    assert a.assignments == {(0, "formal-analysis"), (1, "software")}


def test_impossible_year_is_dropped():
    a = parse_article(article(contrib("Ann", "Smith")).replace(b"<year>2024</year>", b"<year>20225</year>"))
    assert a.year is None


def test_double_encoded_text_is_repaired():
    mojibake = "Ann Smith: writingâ\u0080\u0094review and editing; â\u0080\u009cquotedâ\u0080\u009d"
    a = parse_article(
        article(contrib("Ann", "SmÄ\u0083th"), f"<sec><title>Author contributions</title><p>{mojibake}</p></sec>")
    )
    assert a.authors[0].surname == "Smăth"
    assert a.statement == "Ann Smith: writing—review and editing; “quoted”"
    assert parse_article(article(contrib("Zoë", "Café"))).authors[0].name == "Zoë Café"  # real Latin-1 stays
    # continuation bytes Python counts as whitespace: "\xa0" in "à", "\x85" in "Å"
    assert parse_article(article(contrib("NicolÃ ", "Ã\u0085berg"))).authors[0].name == "Nicolà Åberg"


@pytest.mark.parametrize("title", ["Green credit policy", "Author gender", "Authorship criteria and credit"])
def test_body_sections_about_credit_or_authors_are_not_statements(title):
    xml = article(contrib("Ann", "Smith")).replace(
        b"</front>", f"</front><body><sec><title>{title}</title><p>AS: formal analysis.</p></sec></body>".encode()
    )
    assert parse_article(xml).statement is None


def test_prose_naming_only_common_role_words_is_not_credit():
    back = "<sec><title>Authors' contributions</title><p>AS performed the review under the supervision of BJ.</p></sec>"
    a = parse_article(article(contrib("Ann", "Smith") + contrib("Bo", "Jones"), back))
    assert (a.style, a.assignments) == ("none", set())
    assert a.statement


def test_a_body_contributions_section_is_the_papers_not_the_authors():
    role = '<role vocab="credit" vocab-term-identifier="https://credit.niso.org/contributor-roles/software/">S</role>'
    xml = article(contrib("Ann", "Smith", role)).replace(
        b"</front>", b"</front><body><sec><title>Contributions</title><p>We release software.</p></sec></body>"
    )
    assert parse_article(xml).statement is None
    back = "<sec><title>Contributions</title><p>AS: software, visualization.</p></sec>"
    assert parse_article(article(contrib("Ann", "Smith"), back)).style == "statement_text"


@pytest.mark.parametrize(
    ("raw", "repaired"),
    [
        ("Ä\u0083", "ă"),  # second byte a C1 control
        ("Å ", "Š"),
        ("Î±", "α"),
        ("SzleÌ¨k", "Szlęk"),  # a combining mark, composed by NFC
        ("ð\u009f\u0098\u0080", "\U0001f600"),  # four bytes
        ("à\u0080\u0080", "à\u0080\u0080"),  # not valid UTF-8: left as it is
        ("J. Groß and A. JOSÉ GARCÍA", "J. Groß and A. JOSÉ GARCÍA"),
        ("5×±2", "5×±2"),
        ("Ö¿", "Ö¿"),
        ("2 Å²", "2 Å²"),  # square ångström
    ],
)
def test_only_plausible_double_encoding_is_repaired(raw, repaired):
    assert parse_article(article(contrib("Ann", raw))).authors[0].surname == repaired


def test_decomposed_accents_are_composed():
    back = "<sec><title>Author contributions</title><p>Formal analysis: H.S\u030c.</p></sec>"
    a = parse_article(article(contrib("Hana", "S\u030cigutova\u0301"), back))
    assert a.authors[0].surname == "\u0160igutov\u00e1"
    assert a.assignments == {(0, "formal-analysis")}


@pytest.mark.parametrize("title", ["Author statement", "Contributions of the authors", "Authorship"])
def test_statement_titles(title):
    back = f"<sec><title>{title}</title><p>AS: formal analysis.</p></sec>"
    assert parse_article(article(contrib("Ann", "Smith"), back)).assignments == {(0, "formal-analysis")}


def test_a_statement_title_without_roles_gives_way_to_the_next():
    back = (
        "<sec><title>Author contributions</title><p>All authors wrote the paper.</p></sec>"
        "<sec><title>CRediT authorship contribution statement</title><p>AS: formal analysis.</p></sec>"
    )
    a = parse_article(article(contrib("Ann", "Smith"), back))
    assert (a.style, a.assignments) == ("statement_text", {(0, "formal-analysis")})


def test_back_matter_statement_beats_a_body_statement():
    xml = article(
        contrib("Ann", "Smith"), '<notes notes-type="author-contribution"><p>AS: formal analysis.</p></notes>'
    ).replace(
        b"</front>", b"</front><body><sec><title>Author contributions</title><p>AS: visualization.</p></sec></body>"
    )
    assert parse_article(xml).assignments == {(0, "formal-analysis")}


def test_earliest_publication_year_wins():
    dates = b"<pub-date><year>2025</year></pub-date><pub-date><year>2023</year></pub-date><pub-date><year>2024</year></pub-date>"
    a = parse_article(article(contrib("Ann", "Smith")).replace(b"<pub-date><year>2024</year></pub-date>", dates))
    assert a.year == 2023


def test_license_from_ali_license_ref():
    lic = (
        b'<license><ali:license_ref xmlns:ali="http://www.niso.org/schemas/ali/1.0/">'
        b"https://creativecommons.org/licenses/by-nc/4.0/</ali:license_ref></license>"
    )
    xml = article(contrib("Ann", "Smith")).replace(
        b'<license xlink:href="https://creativecommons.org/licenses/by/4.0/"/>', lic
    )
    assert parse_article(xml).license == "https://creativecommons.org/licenses/by-nc/4.0/"
