# CRediT Matrix

[![CI](https://github.com/simonvanlierde/credit-matrix/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/simonvanlierde/credit-matrix/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/simonvanlierde/credit-matrix/branch/main/graph/badge.svg)](https://codecov.io/gh/simonvanlierde/credit-matrix)
[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/simonvanlierde/credit-matrix?utm_source=badge)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fcredit.duinlab.nl)](https://credit.duinlab.nl)
[![npm](https://img.shields.io/npm/v/credit-matrix)](https://www.npmjs.com/package/credit-matrix)
[![DOI](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.21213659-blue.svg)](https://doi.org/10.5281/zenodo.21213659)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

A web app for writing the contribution statement of a paper: who did what, in the 14 roles of
[CRediT (Contributor Roles Taxonomy)](https://credit.niso.org/). It was formerly
called *CRediT Generator*. Add your contributors, give each of them their roles, and copy a
statement for the manuscript, a **contribution heatmap** figure, or files for journal submission
systems: JATS4R XML, CSV, JSON, and Markdown.

Each co-author can check their own row through a link, and everything runs in your browser: only
the ORCID and DOI lookups, the fetch of ORCID's public keys and the hosted site's cookieless Cloudflare
Web Analytics beacon leave it. CRediT Matrix is an independent project. It is not affiliated
with or endorsed by NISO.

**Try it:** [credit.duinlab.nl](https://credit.duinlab.nl)

![The CRediT Matrix workspace with sample data: a contributor rail on the left, the contribution grid as the main canvas with a strip above it counting answered co-authors, and an inspector on the right with Statement, Team and Review tabs. The Team tab is open and lists each contributor as not asked yet, with a Copy message button per person and an Ask everyone not yet asked button](docs/screenshots/hero.png)

| First run | Statement & export |
|---|---|
| ![The first-run welcome as a dialog over the empty workspace: three numbered steps, notes on drafts and asking co-authors, and Load sample data and Start fresh buttons](docs/screenshots/empty-state.png) | ![The Statement tab of the inspector: a By author or By role switch, the generated statement, a Copy statement button, and the open Export data menu with Copy and Download for XML (JATS4R), JSON, CSV and Markdown](docs/screenshots/statement-export.png) |

## Quick start

Run it yourself (Node ≥ 26, pnpm ≥ 11):

```bash
git clone https://github.com/simonvanlierde/credit-matrix
cd credit-matrix
pnpm install
pnpm dev            # → http://localhost:3000
```

Or use the same logic elsewhere:

- the [`credit-matrix` package and CLI](src/core/README.md), for Node and the browser
- the [`<credit-matrix>` element](docs/element.md), to show a statement and heatmap on any web page
- the [Quarto extension](integrations/quarto/README.md) and [MyST plugin](integrations/myst/README.md),
  to write the statement from your manuscript's front matter

The [CRediT census](census/README.md) in `census/` is a separate Python pipeline that reads roles
from open-access papers, for the Published practice tab and a public dataset.

## Docs

[Architecture](docs/architecture.md) · [Deploying](docs/deploy.md) ·
[Accessibility statement](docs/accessibility.md) · [JATS conformance suite](conformance/README.md) ·
[Design decisions](docs/adr/) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

## Acknowledgements

- The original
  [Python/Dash CRediT Generator](https://github.com/IPHYS-Bioinformatics/CRediT-Generator), which
  inspired this app.
- Role translations from
  [credit-translation](https://github.com/contributorshipcollaboration/credit-translation).
- The **contribution matrix** proposed by Nick Steinmetz (2019), which this app's heatmap descends
  from. *Nature Index* surveys it in
  ["Researchers are embracing visual tools to give fair credit…"](https://www.nature.com/nature-index/news/researchers-embracing-visual-tools-contribution-matrix-give-fair-credit-authors-scientific-papers).

[docs/related-work.md](docs/related-work.md) lists the research this app builds on.

## Citing this software

If you use CRediT Matrix in your work, please cite it. [CITATION.cff](CITATION.cff) has the
details, and GitHub's "Cite this repository" button turns them into APA and BibTeX. The archived
releases are on Zenodo: [doi:10.5281/zenodo.21213659](https://doi.org/10.5281/zenodo.21213659).

> van Lierde, S. *CRediT Matrix* [Computer software]. Zenodo.
> <https://doi.org/10.5281/zenodo.21213659>

## License

[MIT](LICENSE) © Simon van Lierde. The bundled fonts, IBM Plex and Newsreader, are under the SIL
Open Font License: [IBM Plex](public/fonts/OFL-ibm-plex.txt),
[Newsreader](public/fonts/OFL-newsreader.txt).
