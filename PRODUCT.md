# Product brief

Read this before you write text or design screens for CRediT Matrix. It says who the app is for,
what it promises, and what we may claim about it. It is not user documentation. For what the app
does, read the [README](README.md). For the visual rules, read [DESIGN.md](DESIGN.md).

## Users

Researchers and research teams who are preparing a manuscript. They use CRediT, the Contributor
Roles Taxonomy, to agree on each contributor's work, write it down, and export it.

## Purpose

CRediT Matrix turns contributor names and their roles into a statement ready for the manuscript,
and into files for submission. Teams never have to format the roles by hand.

The contribution matrix is where you edit, and it is also the heatmap you can download. The same
data produces the statement text, JATS4R XML, CSV, JSON, and Markdown.

## Operating context

People use the app while they write and revise a manuscript, next to their author list, ORCID
records, the journal's requirements, and talks with co-authors. Drafts are saved in the browser.
A user can share a draft as a URL, or import a file in one of the supported formats.

## Capabilities

- Add, rename, reorder, paste, import, and classify contributors. Look up names through ORCID, or
  fill a whole list from a DOI, if you want to.
- Assign all 14 official CRediT roles as yes/no values or contribution levels.
- Ask co-authors by link for their own row. Keep each answer beside the draft, and settle every
  difference in one place.
- Translate statements and exports meant for people. Keep the official English terms in formats
  meant for software.

## Constraints

- Keep contribution data in the browser. The ORCID and DOI lookups are the only calls that leave
  it, and they go straight to ORCID, Crossref and DataCite.
- Protect scientific accuracy, privacy, accessibility, and translations. Data you export and import
  back must come back the same.

## Voice and claims

The product name is **CRediT Matrix**. What it's known for is the **contribution heatmap**. Use
that full term in text, documentation, and help, so people carry it into their methods sections.
A control with little room may shorten it to *Heatmap*, once the full term is already on screen.

The voice is direct, precise, calm, and useful. Explain specialist ideas without making them less
exact. A non-author contributor is called exactly that in text and docs. A control with little room
may shorten it to *Non-author*, but never to *Contributor*, because everyone on the list is a
contributor.

Back every claim with something in the repo: the workflow in `src/`, the screenshots in
`docs/screenshots/`, the tests in `src/core/`, the records in `docs/adr/`, or `CITATION.cff`. Don't
invent testimonials, customer logos, usage statistics, or performance numbers.

## Principles

- The shortest clear path through the app should end in an accurate contribution statement.
- Keep contributors, their roles, and the output visibly connected.
- Teach with examples and help in place, not with tutorials that block the screen.
- Keep the user's work through refreshes, errors, imports, and interruptions.
- Accessibility, translation, privacy, and correct exports are part of how the product works, not
  extras.

## Accessibility and inclusion

The whole workflow must work with a keyboard, a screen reader, a narrow screen, and 200% zoom. It
must not rely on color alone. Translated output must leave room for longer labels and for scripts
other than the Latin alphabet.
