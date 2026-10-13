import re
from pathlib import Path

import duckdb
import pytest

from observatory.cli import extract
from observatory.jats import parse_article
from observatory.roles import ROLE_PATTERNS


def article(contribs: str, back: str = "") -> bytes:
    return f"""<article xmlns:xlink="http://www.w3.org/1999/xlink"><front>
<journal-meta><journal-title-group><journal-title>Test J</journal-title></journal-title-group>
<publisher><publisher-name>Test Press</publisher-name></publisher></journal-meta>
<article-meta><article-id pub-id-type="pmcid">PMC1</article-id><article-id pub-id-type="doi">10.1/x</article-id>
<contrib-group>{contribs}</contrib-group>
<pub-date><year>2024</year></pub-date>
<permissions><license xlink:href="https://creativecommons.org/licenses/by/4.0/"/></permissions>
</article-meta></front><back>{back}</back></article>""".encode()


def contrib(given: str, surname: str, inner: str = "", attrs: str = 'contrib-type="author"') -> str:
    return (
        f"<contrib {attrs}><name><surname>{surname}</surname><given-names>{given}</given-names></name>{inner}</contrib>"
    )


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
    assert a.authors[0].orcid == "https://orcid.org/0000-0002-1825-0097"
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
        '<notes notes-type="author-contribution"><p>A.S.: software; B.J.: validation.</p></notes>',
        "<sec><title>CRediT authorship contribution statement</title><p>Ann Smith: Software. Bo Jones: Validation.</p></sec>",
        "<fn-group><fn><p><bold>Contributors:</bold> AS: software. BJ: validation.</p></fn></fn-group>",
    ],
)
def test_statement_text(back):
    a = parse_article(article(contrib("Ann", "Smith") + contrib("Bo", "Jones"), back))
    assert a.style == "statement_text"
    assert a.assignments == {(0, "software"), (1, "validation")}
    assert a.statement


def test_unparsed_statement_is_kept():
    back = "<sec><title>Author contributions</title><p>Software and validation by the team.</p></sec>"
    a = parse_article(article(contrib("Ann", "Smith"), back))
    assert (a.style, a.assignments) == ("none", set())
    assert a.statement == "Software and validation by the team."


def test_extract_writes_tables(tmp_path):
    xml_dir = tmp_path / "xml"
    xml_dir.mkdir()
    (xml_dir / "PMC1.xml").write_bytes(
        article(contrib("Ann", "Smith", "<role>Software</role>") + contrib("Bo", "Jones"))
    )
    (xml_dir / "PMC2.xml").write_bytes(b"<article><broken")
    manifest = [{"pmcid": p, "stratum": "test", "year": "2024"} for p in ("PMC1", "PMC2", "PMC3")]
    assert extract(manifest, xml_dir, tmp_path / "o.duckdb") == 1
    with duckdb.connect(str(tmp_path / "o.duckdb")) as con:
        assert con.sql("SELECT pmcid, style, n_authors, n_authors_with_roles FROM articles ORDER BY 1").fetchall() == [
            ("PMC1", "contrib_text", 2, 1),
            ("PMC2", "error", 0, 0),
        ]
        assert con.sql("SELECT * FROM assignments").fetchall() == [("PMC1", 1, "Ann Smith", None, "software")]


def test_contrib_text_keeps_its_source_text():
    a = parse_article(article(contrib("Ann", "Smith", "<role>Software, Validation</role>") + contrib("Bo", "Jones")))
    assert a.statement == "1. Ann Smith: Software, Validation"


def test_contribution_to_the_field_is_not_a_statement():
    back = "<sec><title>Contribution to the field</title><p>AS: software.</p></sec>"
    a = parse_article(article(contrib("Ann", "Smith"), back))
    assert (a.style, a.statement) == ("none", None)
