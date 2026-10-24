# Security policy

## Reporting a vulnerability

Report it privately through GitHub:
[Report a vulnerability](https://github.com/simonvanlierde/credit-matrix/security/advisories/new).
Don't open a public issue or pull request for a security problem: anyone can read those before
there is a fix.

Please include:

- What you found and where.
- How to reproduce it, and which version or URL you tested.
- The impact you expect.

This is a single-maintainer project. I acknowledge a report within 14 days, then tell you whether
I can reproduce it and when I expect a fix.

## Fixes and disclosure

A fix lands on `main` and the live site deploys it. If it touches the `credit-matrix` npm
package, it also ships in a new tagged release. When the fix is live, I publish the GitHub
security advisory for it, with a CVE where one applies, and credit you unless you'd rather not
be named. The CHANGELOG entry for the fix links the advisory.

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
