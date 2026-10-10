# Security policy

## Reporting a vulnerability

Report it privately through GitHub:
[Report a vulnerability](https://github.com/simonvanlierde/credit-matrix/security/advisories/new).
Please do not open a public issue for a security problem.

Say what you found, how to reproduce it, and which version or URL you tested. This is a
single-maintainer project, so replies can take a few days.

## Scope

CRediT Matrix is a static, client-side app. It has no accounts and no server that stores data
(see [ADR 0002](docs/adr/0002-no-accounts-or-server-side-storage.md)). Drafts stay in your
browser. In scope:

- Script injection (XSS) through names, imports, share links, or exports.
- Weaknesses in the Content Security Policy in [`public/_headers`](public/_headers).
- Wrong data sent to the lookup services (ORCID, Crossref, DataCite).
- A published build or dependency that contains a known vulnerability.

Out of scope: problems in the third-party services themselves, and attacks that need access to
the victim's browser profile or device.

## Supported versions

Only the latest release and the live site at <https://credit.duinlab.nl>.
