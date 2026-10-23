# Governance

CRediT Matrix has one maintainer, Simon van Lierde. This file says who decides and who has access.

## Who decides

The maintainer decides what goes into the app and the `credit-matrix` package, and when to release.
Anyone can propose a change in an issue or a pull request. I weigh each proposal against
[PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md), and I record larger design decisions as
[ADRs](docs/adr/), with the reasons. If I turn a proposal down, I say why in the issue or pull
request.

The planned work is in the [roadmap](docs/roadmap.md).

## Who has access

- **Repository:** only the maintainer has write and admin access. All other changes come in
  through pull requests.
- **npm package:** only the maintainer owns `credit-matrix` on npm. The release workflow publishes
  it from a `v*` tag through npm trusted publishing, with provenance, so no npm token is stored.
- **Hosting:** only the maintainer has access to the Cloudflare account that serves
  <https://credit.duinlab.nl>. CI deploys `main` after every check passes.
- **Bots:** Renovate opens dependency updates and merges minor and patch updates once every check
  passes. It cannot merge majors.

## If the maintainer is unavailable

The code, the release history and the docs are public under the MIT license, so anyone can fork the
project. The site is a static build: it keeps working without upkeep until a dependency or a lookup
service changes.

## Changes to this file

The maintainer changes this file through a pull request, like any other change. If more people get
access, this file will name their role first.
