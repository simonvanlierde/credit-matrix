---
title: 'CRediT Matrix: drafting CRediT contribution statements with co-authors'
tags:
  - CRediT
  - authorship
  - contributorship
  - JATS
  - ORCID
  - scholarly publishing
  - TypeScript
authors:
  - given-names: Simon
    non-dropping-particle: van
    surname: Lierde
    orcid: 0009-0006-6953-909X
    affiliation: 1
affiliations:
  # TODO(Simon): CITATION.cff and codemeta.json give no affiliation. Your public ORCID record
  # lists Leiden University (ROR 027bh9e22). Confirm the name (and any department), then
  # replace this entry and add `ror: 027bh9e22` if it is right.
  - name: 'TODO: affiliation'
    index: 1
date: 18 October 2026
bibliography: paper.bib
---

<!-- JOSS papers use level-1 section headings; the front matter title is not one. -->
<!-- rumdl-disable MD025 -->

# Summary

Many journals ask authors to say who did what in a paper using CRediT, the Contributor Roles
Taxonomy. CRediT is a NISO standard of 14 roles, such as Conceptualization, Software and
Writing – original draft [@allen2014; @brand2015; @niso2022credit]. CRediT Matrix is a web
application and TypeScript package for drafting this statement together with all co-authors.
The lead author fills in a grid of contributors and roles, optionally with a level for each
cell (lead, equal or supporting). Each co-author gets a link to their own row, fills it in and
sends a reply link back. The application shows where each reply differs from the lead's
draft, and the lead settles every difference. It then writes the statement in nine languages,
a contribution heatmap figure, and files for submission systems: JATS XML (the
XML format most journals use for articles) that follows the JATS4R recommendation
[@jats4r_credit], a set of tagging rules for publishers, CSV, JSON and Markdown. Everything runs in the
browser, and no server stores the draft. The same code is published as the `credit-matrix`
npm package, with a command-line tool, a `<credit-matrix>` web element (a custom HTML tag that works in any page), and plugins for Quarto
and MyST. The repository also holds the CRediT census, a separate Python pipeline that reads
the roles declared in biomedical open-access papers from Europe PMC.

# Statement of need

A CRediT statement is often written by one person: the first or corresponding author states
the contributions of all co-authors. Tools that collect each author's own account, such as
CRediTas and tenzing [@creditas; @holcombe2020], merge the accounts into one table. Yet the
accounts differ. In a prospective study of 919 authors of 201 manuscripts submitted to one
general medical journal, corresponding authors disagreed with co-authors about those
co-authors' contributions in 69.4% of cases, and 69.7% of corresponding authors changed at
least one answer about their own work between two forms [@ilakovac2007]. The way the question
is asked also changes the answer. In a meta-analysis of 19 surveys that the authors rate as
of low methodological quality, researchers saw a co-author as honorary on 51% of papers when
asked to declare what each co-author did, against 26% when given no authorship criteria and
18% when referred to the ICMJE criteria [@meursinge2024].

CRediT Matrix lets each co-author answer for themselves and keeps the answers apart. A
co-author's reply never overwrites the lead's row. It is stored beside that row, and every role
where the two differ stays marked until the lead takes the co-author's level or keeps their
own. The tool keeps a record of the answers and leaves the decision to the team; it makes no
claim that this reduces disputes. Its users are research teams who write multi-author papers,
and the developers of journals, publishing platforms and authoring tools who need CRediT output
that is valid against the standards they read.

# State of the field

tenzing is the closest and best-documented tool [@holcombe2020; @tenzing]. It is an R
package with a Shiny web application. The team fills in one shared spreadsheet, and tenzing
turns it into a contribution report, affiliation text, JATS XML, YAML for the `papaja` package,
and funding and conflict-of-interest sections. Its template records each role as done or not,
without a level. CRediTas, an R package reviewed by rOpenSci, turns a CSV template into a
statement in a text file [@creditas]. `latex-credits` defines a LaTeX command per author that
prints the statement [@latexcredits]. Publishing platforms now capture roles themselves. Open
Journal Systems (OJS) has CRediT roles in its core from version 3.6, with a plugin for versions
3.3 to 3.5 [@pkpcredit], and Quarto and MyST read roles from a document's author metadata
[@quartoauthors; @mystfrontmatter]. By default, Quarto and MyST print no statement from those roles.

None of these tools collects a separate answer from each co-author or compares the answers
with the lead's draft. We judged that adding that to tenzing would replace its central design,
one shared table for the whole team. tenzing can also run locally with `tenzing::run_app()`, but
it remains an R application. CRediT Matrix keeps drafts off servers altogether, so we built it as
a separate tool that works alongside tenzing. It imports
tenzing's spreadsheet, uses the CRediT role translations published by the same group
[@holcombe2026], and publishes a conformance suite that tenzing or any other tool can use to
test its JATS output. Writing that suite turned up a mismatch in the official JATS4R rules,
which spell one role "Formal Analysis" where NISO writes "Formal analysis"; it was reported
upstream [@jats4r_schematrons].

Large studies of declared roles exist, for example of 30,054 PLOS papers [@lariviere2021] and
of over 400,000 articles from several publishers [@assraf2025]. The census reads all four ways
in which publishers mark up roles, including free-text statements that name authors by their
initials. It covers the biomedical open-access literature in Europe PMC [@europepmc_oa], read
from a pinned snapshot whose files are checked by hash.

# Software design

The main trade-off is privacy against convenience. A draft holds the names and ORCID iDs of
co-authors who never visited the site, so the application is a static export with no accounts
and no server-side storage. A draft lives in the browser's local storage. An ask link carries
one co-author's row in the URL fragment, which browsers do not send to the server, and the
reply comes back the same way. The cost is that co-authors paste a link instead of seeing their
answer arrive by itself. A relay that would store only encrypted replies is described in a
design record but not built; it waits until users ask for it. The page's own network calls are
the public ORCID, Crossref and DataCite lookups, the ORCID sign-in and the fetch of ORCID's
public keys. The hosted site also loads Cloudflare Web Analytics, a cookieless beacon that the
edge injects. The Content Security Policy limits the page to these hosts.

A reply can carry an ORCID sign-in. The co-author signs in through ORCID's OpenID Connect
implicit flow, which needs no client secret and therefore no server of ours. The nonce sent to
ORCID is the SHA-256 hash of the reply, so the token that ORCID signs names that exact answer
and cannot be moved onto another. The lead's browser checks the signature against ORCID's
public keys. This feature is merged but not yet in a tagged release.
<!-- TODO(Simon): update at the next tag. -->

All domain logic sits in `src/core`, plain TypeScript whose only runtime dependency is Zod, and
a lint rule keeps React and Next.js out of it. The web application, the npm package, the
command-line tool and the web element share this code. The Quarto filter, written in Lua, and
the MyST plugin follow its statement wording, and the Quarto filter's output is tested against
it. Each cell stores an integer score from 0 to 100 rather than a yes or no, so the interface
can switch between yes/no and the three levels without changing stored data. Answers are
compared by level, not by raw score, and levels are exported as JATS `degree-contribution`.

Every CI run validates the JATS export against the JATS 1.3 DTD [@niso2021jats] and the JATS4R
Schematron rules, and a test fails when the export of a conformance case differs from its
expected file. The interface aims at WCAG 2.2 AA. The end-to-end tests run axe-core and
keyboard-only checks, but there has been no audit and no testing by users of assistive
technology.

# Research impact statement

The first commit dates from March 2026. There have been ten releases, from 0.1.0 in June 2026
to 0.8.1 in October 2026. Zenodo archives nine of them, 0.1.1 to 0.8.1, under one concept DOI
[@creditmatrix]. The package is on npm (<https://www.npmjs.com/package/credit-matrix>), with
provenance attestations since 0.8.1. The software has an entry in the Research Software Directory
(<https://research-software-directory.org/software/credit-matrix>) and is listed in awesome-PhD
(<https://github.com/helenahartmann/awesome-PhD/pull/51>). While writing the conformance suite we
filed JATS4R issue 41 (<https://github.com/JATS4R/jats-schematrons/issues/41>); a fix is proposed
in pull request 42 (<https://github.com/JATS4R/jats-schematrons/pull/42>).

TODO: census dataset DOI and parser accuracy; Papers 1 and 2; outside users.

<!-- TODO(Simon): cite the census dataset DOI here once it is on Zenodo, and add the parser
accuracy from the hand-labelled set (census/README.md, Validation) once it is scored.
     Then restate the census figures below with the DOI. They are in no tracked file yet, and the
     scope is Europe PMC, which is biomedical by construction:
     the October 2026 run read 8,237,783 articles from the Europe PMC open-access subset and found
     CRediT roles in 2,105,251 of them, with 46.9 million author-role assignments. Among research
     articles, the share that declares roles rose from 6.2% in 2017 to 50.2% in 2025. -->

<!-- TODO(Simon): Papers 1 and 2. Once both teams have answered, state what the consensus view
showed: how many co-authors were asked, how many replied, how many roles differed from the
lead's draft, and how they were settled. Report only counts the co-authors agreed to share. -->

<!-- TODO(Simon): outside users. Name groups, journals or platforms that use the app, the
package or the conformance suite, with a link for each. Leave this out if there are none at
submission. -->

# AI usage disclosure

TODO: AI usage disclosure.

<!-- TODO(Simon): JOSS requires this section. State whether generative AI was used to write the
software, its documentation, or this paper. If it was not, say so in one sentence. If it was,
name each tool and model with its version, say what it was used for in each of the three
areas, and describe how you checked the quality and correctness of what it produced (for
example review of every change, the test suite and CI, and checking each citation against
its source). -->

# Acknowledgements

The original Python/Dash CRediT Generator by IPHYS Bioinformatics inspired this application.
The role names in eight languages come from the credit-translation project of the
Contributorship Collaboration [@holcombe2026]. The contribution heatmap descends from the
contribution matrix proposed by Nick Steinmetz in 2019.

TODO: financial support.

<!-- TODO(Simon): name any financial support, or state that the work received none. -->

# References
