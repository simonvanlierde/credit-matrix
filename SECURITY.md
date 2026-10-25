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

This is a single-maintainer project ([GOVERNANCE.md](GOVERNANCE.md)).

## Disclosure timeline

- I reply within two weeks to confirm I received your report.
- I aim to fix a confirmed vulnerability, or agree a later date with you, within 90 days of the
  report.
- A fix lands on `main` and the live site deploys it. If it touches the `credit-matrix` npm
  package, it also ships in a new tagged release.
- When the fix is live, I publish a GitHub security advisory with the affected and fixed versions,
  and request a CVE when the package is affected. The CHANGELOG entry for the fix links the
  advisory.
- Please keep the details private until the advisory is out, or until 90 days have passed or the
  later date we agreed, whichever comes first.
- I credit you by name in the advisory if you ask for it. Say how you want to be named.

## Security model

- **No server holds your data.** The app is a static build
  ([ADR 0002](docs/adr/0002-no-accounts-or-server-side-storage.md)). Drafts live in your browser's
  storage. Share and reply links carry the draft in the URL fragment, which browsers do not send
  with page requests, and the app clears it from the address bar once it has read it. Until then,
  scripts on the page can read it, including the hosted site's analytics beacon. There are no
  accounts and no passwords to steal.
- **Few outside calls.** Only the ORCID and DOI lookups, the fetch of ORCID's public keys and the
  hosted site's cookieless analytics beacon leave the browser. A lookup sends the ORCID iD or DOI
  you typed to ORCID, Crossref or DataCite. The Content Security Policy in
  [`public/_headers`](public/_headers) allows no other hosts and blocks framing.
- **ORCID sign-in.** A co-author who signs in leaves the page for orcid.org. The request carries a
  hash of the reply, not the reply. ORCID returns a signed token in the URL fragment, and the app
  checks it in the browser against ORCID's public keys. The token then travels inside the reply link.
- **Links and storage.** Anyone who gets a share or reply link can read the draft in it, so send
  it only to the people who should see it. Drafts in browser storage are not encrypted.
- **Untrusted input.** Names, imports, share links and pasted statements come from other people,
  so the app treats them as text and checks their shape before use. Property tests feed random
  input to the file and link importers.
- **Supply chain.** Dependencies are pinned in `pnpm-lock.yaml`, and new releases wait before
  they are installed (see [CONTRIBUTING.md](CONTRIBUTING.md#dependencies)). CI pins actions by
  digest, attests the provenance of the deployed build, and publishes the npm package with
  provenance and no stored token.

The [assurance case](docs/assurance-case.md) gives the threat model and the argument in full.

## Scope

In scope:

- Script injection (XSS) through names, imports, share links, or exports.
- Weaknesses in the Content Security Policy in [`public/_headers`](public/_headers).
- Wrong data sent to the lookup services (ORCID, Crossref, DataCite).
- A published build or dependency that contains a known vulnerability.

Out of scope: problems in the third-party services themselves, and attacks that need access to
the victim's browser profile or device.

## Supported versions

Only the latest release and the live site at <https://credit.duinlab.nl>.
