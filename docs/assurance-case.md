# Assurance case

This is the argument that CRediT Matrix meets its security needs: what could be harmed, where the
trust boundaries are, which threats I considered and how the code counters each one, and what is
left. Every claim points to the file or decision record that backs it. Where I could not check a
claim in this repository, the text says "not verified". Where I checked a claim by hand rather than
with a test, the text gives the date.

To report a problem, see [SECURITY.md](../SECURITY.md).

## Scope and assets

The project has three parts: the web app at <https://credit.duinlab.nl>, the `credit-matrix` npm
package built from [`src/core`](../src/core/README.md), and the census in [`census/`](../census/README.md).

What could be harmed:

- **Drafts in the browser.** A draft holds the names and ORCID iDs of co-authors, and their roles.
  It lives in the browser's `localStorage`, unencrypted
  ([ADR 0002](adr/0002-no-accounts-or-server-side-storage.md)).
- **Share and reply links.** A link carries a draft, or one person's row, in its URL fragment
  ([`src/core/share-link.ts`](../src/core/share-link.ts),
  [`src/core/share-payload.ts`](../src/core/share-payload.ts)). Anyone who holds it can read it.
- **ORCID proofs.** A reply link can carry an ORCID `id_token` that shows who answered
  ([`src/core/orcid-proof.ts`](../src/core/orcid-proof.ts)). A forged proof would let someone
  answer in another person's name.
- **The npm package.** Other tools import `credit-matrix` and run its CLI
  ([`.github/workflows/release-core.yml`](../.github/workflows/release-core.yml)).
- **The deployed site.** The static files the live site serves. Tampered files would run in every
  visitor's browser. A service worker ([`public/sw.js`](../public/sw.js)) keeps a copy of the last
  build a visitor loaded and serves it when the network is down. Online, a new build takes over on
  the next visit.
- **The census outputs.** [`src/data/field-norms.json`](../src/data/field-norms.json), which the app
  shows as field norms, and the snapshot manifests and hashes that pin what the census read
  ([census README](../census/README.md#what-makes-a-run-reproducible)).

There are no accounts, passwords or server-side drafts to protect, because there is no server
([ADR 0002](adr/0002-no-accounts-or-server-side-storage.md),
[ADR 0003](adr/0003-static-export.md)).

## Trust boundaries

| Boundary | What crosses it | Trusted? |
| --- | --- | --- |
| The user's browser | All app code runs here, and all drafts stay here | Trusted. Attacks that need the user's device or browser profile are out of scope ([SECURITY.md](../SECURITY.md#scope)) |
| The static host (Cloudflare) | Serves the built files and the headers in [`public/_headers`](../public/_headers). Runs no code of ours ([ADR 0003](adr/0003-static-export.md)) | Trusted to serve what CI built. It also injects the Web Analytics script ([`public/_headers`](../public/_headers)) |
| ORCID (`pub.orcid.org`, `orcid.org`) | An ORCID iD out, a name back; the sign-in page; the public signing keys | Responses are parsed with a schema before use ([`src/core/orcid-lookup.ts`](../src/core/orcid-lookup.ts), [`src/core/orcid-proof.ts`](../src/core/orcid-proof.ts)) |
| Crossref, DataCite | A DOI out, article metadata back | Responses are parsed with a schema before use ([`src/core/doi-lookup.ts`](../src/core/doi-lookup.ts)) |
| Share and reply links | A whole draft or one person's row, from someone else | Untrusted. Decoded with size caps and a schema ([`src/core/share-link.ts`](../src/core/share-link.ts)) |
| Imported files and pasted text | JATS XML, JSON, CSV, tenzing sheets, name lists, statements | Untrusted. Size cap, then a format reader per type ([`src/core/import.ts`](../src/core/import.ts)) |
| npm consumers | Pages and tools that import the package or embed its web element | They trust us. The element fetches whatever `src` the host page gives it ([`src/core/element.ts`](../src/core/element.ts)) |
| Census inputs (PMC, Europe PMC, OpenAlex) | Article XML and journal fields | Untrusted XML, parsed with entities off. Output reaches the app only as a committed JSON file |
| GitHub Actions, npm, Renovate | Code, dependencies, the release | Trusted with pins and narrow permissions (see [Supply chain](#supply-chain)) |

## Threats and counters

### Script injection (XSS)

- **Rendering.** The app is React, which escapes text. The only raw HTML in the app is a constant
  script in [`src/app/layout.tsx`](../src/app/layout.tsx) that holds no user input. The web element
  builds the heatmap SVG as a string and assigns it with `innerHTML`
  ([`src/core/element.ts`](../src/core/element.ts)). Every name and label in that SVG goes through
  `escapeXml` ([`src/core/export/heatmap-svg.ts`](../src/core/export/heatmap-svg.ts),
  [`src/core/export/escape-xml.ts`](../src/core/export/escape-xml.ts)).
- **Content Security Policy.** [`public/_headers`](../public/_headers) sets one policy for the whole
  site: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`,
  `frame-ancestors 'none'`, and `connect-src` limited to ORCID, Crossref, DataCite and the analytics
  endpoint. At build time [`scripts/postbuild.mjs`](../scripts/postbuild.mjs) swaps
  `'unsafe-inline'` in `script-src` for the hash of each inline script the export emits, and fails
  the build if it cannot. So injected markup cannot run inline script on the deployed site.
- **Exports.** XML and SVG output escapes the five XML entities and drops characters XML cannot hold
  ([`src/core/export/escape-xml.ts`](../src/core/export/escape-xml.ts)). CSV output prefixes cells
  that a spreadsheet could read as a formula ([`src/core/export/csv.ts`](../src/core/export/csv.ts)).
- **Other headers.** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, HSTS, and a Permissions-Policy that turns off camera,
  geolocation and microphone ([`public/_headers`](../public/_headers)).

### Malicious imports

- **Size.** The import dialog refuses a file or pasted text over 1 MB (`MAX_IMPORT_BYTES` in
  [`src/core/author.ts`](../src/core/author.ts), checked in
  [`src/components/ImportModal.tsx`](../src/components/ImportModal.tsx)). The web element applies the
  same cap to what it fetches ([`src/core/element.ts`](../src/core/element.ts)).
- **Shape.** JSON goes through a Zod schema ([`src/core/export/json.ts`](../src/core/export/json.ts)).
  The CSV, tenzing, XML and name-list readers build each row with `createAuthor`, which caps a name
  at 500 characters. The store and the CLI pass every roster through `normalizeRoster`, which caps a
  draft at 200 contributors and rebuilds each row
  ([`src/core/parse-authors.ts`](../src/core/parse-authors.ts),
  [`src/core/author.ts`](../src/core/author.ts)). Share links clamp scores to 0 to 100.
- **XML.** The app parses JATS with the browser's own `DOMParser` and reads only element text and
  attributes from it ([`src/core/export/xml-import.ts`](../src/core/export/xml-import.ts)). The code
  does not reject a `DOCTYPE` and does not configure entity handling. Checked by hand on 2026-10-25
  in Chromium 156, Firefox 157 and WebKit 27.2: `DOMParser` does not load external (`SYSTEM`)
  entities. It expands internal entities declared in the file. It refuses a nested "billion laughs"
  expansion with a parse error, which the importer reports. The CLI parses with linkedom instead,
  after a tag-balance check ([`src/core/cli.ts`](../src/core/cli.ts)). linkedom 0.18.13 ignores the
  `DOCTYPE` and leaves each entity reference as literal text (`&x;`). One test fixture has a
  `DOCTYPE` with an external DTD reference (`export-jats.xml`). No test feeds the importer an entity
  declaration, so neither behaviour is pinned.
- **Testing.** Property tests feed random strings to `importAny` and random JSON to the share
  payload reader, and require a result or a documented error
  ([`src/core/__tests__/properties.test.ts`](../src/core/__tests__/properties.test.ts)).

### Share-link tampering

- **Decoding.** A link must match `#s=` plus base64url, and its encoded length is capped. The
  inflate step stops at 1 MB, so a small link cannot decompress into gigabytes. Anything that fails
  to decode opens the normal app instead ([`src/core/share-link.ts`](../src/core/share-link.ts)).
- **Schema.** The payload must be version 2, and its envelope must be consistent: a claim names a
  contributor in the payload, a reply is always a claim, and ids are unique
  ([`src/core/share-payload.ts`](../src/core/share-payload.ts)).
- **Limited reach.** A link addressed to one co-author carries only their own row
  ([`src/core/share-payload.ts`](../src/core/share-payload.ts)). Opening a reply does not overwrite
  the lead's row. The answer is kept beside it and each difference is settled by hand in the Review
  tab ([ADR 0002](adr/0002-no-accounts-or-server-side-storage.md)).
- **No integrity check without sign-in.** A link has no signature of its own. Whoever holds an ask
  link can edit it and send back any answer. Only an ORCID sign-in ties a reply to a person (next
  section).

### ORCID proof forgery

[`src/core/orcid-proof.ts`](../src/core/orcid-proof.ts) and
[`src/lib/orcid-sign-in.ts`](../src/lib/orcid-sign-in.ts) hold the check.

- **Binding to the answer.** The `nonce` sent to ORCID is the SHA-256 of the reply's payload, so
  the token ORCID signs names that exact answer. Changing one score breaks the proof.
- **Signature.** The token must be RS256 and verify against a key from ORCID's published key set,
  fetched over HTTPS. The issuer must be `https://orcid.org`, and the audience must include this
  app's client id.
- **Sign-in round trip.** Before leaving for ORCID, the page stores a random `state` in
  `sessionStorage` and drops the token if the `state` that comes back differs. The token is
  removed from the address bar once read.
- **On the lead's side.** The lead's app checks the token again when a reply arrives, and again when
  a draft file is imported. A proof stays only if it signed a reply to that contributor with the
  same answer ([`src/core/ask.ts`](../src/core/ask.ts)). The Review tab warns when the signed-in iD
  differs from the iD on the row ([`src/components/ReviewPanel.tsx`](../src/components/ReviewPanel.tsx)).
- **Fail closed.** Any parse or check failure returns no proof, and an unreachable ORCID drops the
  sign-in instead of trusting it. The answer stays, without the sign-in.

### Supply chain

- **Lockfiles.** `pnpm-lock.yaml` pins every npm dependency, and CI installs with
  `--frozen-lockfile` ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). The census pins
  Python dependencies in [`census/uv.lock`](../census/uv.lock).
- **Release age.** pnpm refuses releases younger than 3 days
  ([`pnpm-workspace.yaml`](../pnpm-workspace.yaml)). Renovate waits 7 days after a release before it
  proposes it ([`renovate.json5`](../renovate.json5)). The census uses uv's
  `exclude-newer = "7 days"` ([`census/pyproject.toml`](../census/pyproject.toml)).
- **Pinned actions.** Every third-party action is pinned by commit digest, and Renovate keeps the
  pins current (`config:best-practices` in [`renovate.json5`](../renovate.json5)).
- **Narrow CI rights.** Workflows default to `contents: read`. Four jobs can request an OIDC token.
  `attest` in [`ci.yml`](../.github/workflows/ci.yml), `publish` in
  [`release-core.yml`](../.github/workflows/release-core.yml) and the Scorecard job in
  [`scorecard.yml`](../.github/workflows/scorecard.yml) run no project code. The benchmark job in
  [`codspeed.yml`](../.github/workflows/codspeed.yml) does: it runs the census tests with a token
  that CodSpeed uses to authenticate the run. Fork pull requests get no token. Cloudflare secrets live in the
  `production` and `preview` environments, and fork pull requests never get them
  ([docs/deploy.md](deploy.md)).
- **Provenance.** CI attests build provenance for each deployed file. The npm package is published
  through trusted publishing with `--provenance`, so no npm token is stored
  ([`release-core.yml`](../.github/workflows/release-core.yml)).
- **Monitoring.** OpenSSF Scorecard runs in
  [`.github/workflows/scorecard.yml`](../.github/workflows/scorecard.yml).

### Data exposure

- **No server storage.** The site is static files with no Worker code, so there is nowhere for us to
  keep a draft ([ADR 0002](adr/0002-no-accounts-or-server-side-storage.md),
  [ADR 0003](adr/0003-static-export.md)).
- **Few outside calls.** `connect-src` names only the lookup services and the analytics endpoint
  ([`public/_headers`](../public/_headers)). A lookup sends only the ORCID iD or DOI typed in.
- **Fragments, not queries.** Links carry the draft after `#`, which browsers do not send with the
  page request. The app clears the fragment once it has read it
  ([`src/components/HeaderActions.tsx`](../src/components/HeaderActions.tsx)).
  `Referrer-Policy: no-referrer` keeps the page URL out of outgoing requests.
- **The census** keeps raw XML in `census/data/`, which git ignores. The file it writes for the app
  holds counts and shares, no names and no per-article rows
  ([census README](../census/README.md#field-norms-for-the-app)).

### Census inputs

- **XML.** The census parses with lxml set to `resolve_entities=False` and `no_network=True`, and
  drops comments and processing instructions ([`census/src/census/jats.py`](../census/src/census/jats.py),
  [`census/src/census/rows.py`](../census/src/census/rows.py)).
- **Content pinning.** Bulk files are checked against committed SHA-256 hashes, and a file that
  changed is refused ([`census/src/census/bulk.py`](../census/src/census/bulk.py)).
- **Reaching the app.** Census output enters the app only as `src/data/field-norms.json`, a file
  committed through a pull request and bundled at build time
  ([`src/lib/field-norms.ts`](../src/lib/field-norms.ts)).

## Secure design principles

| Principle | Where it shows |
| --- | --- |
| Economy of mechanism | No server, no accounts, no database ([ADR 0002](adr/0002-no-accounts-or-server-side-storage.md), [ADR 0003](adr/0003-static-export.md)). `src/core` has one runtime dependency, `zod` ([docs/architecture.md](architecture.md)). The CLI bundles `zod` and linkedom into `dist/cli.js` ([`tsdown.config.ts`](../src/core/tsdown.config.ts)), so a fix to either reaches CLI users only through a new `credit-matrix` release |
| Minimal attack surface | No code runs per request, so there is no server to attack ([ADR 0003](adr/0003-static-export.md)). The CSP allows five outside hosts for `connect-src` ([`public/_headers`](../public/_headers)) |
| Fail-safe defaults | A link that does not decode opens the normal app ([`share-link.ts`](../src/core/share-link.ts)). A proof that does not verify is dropped ([`orcid-proof.ts`](../src/core/orcid-proof.ts)). The build fails rather than ship a CSP that blocks or allows the wrong scripts ([`postbuild.mjs`](../scripts/postbuild.mjs)) |
| Least privilege | CI jobs start at `contents: read`. OIDC and secrets sit only in the jobs that need them, and only the CodSpeed benchmarks run project code beside a token ([`ci.yml`](../.github/workflows/ci.yml), [`release-core.yml`](../.github/workflows/release-core.yml)). The page denies camera, microphone and geolocation (`Permissions-Policy`) |
| Complete mediation | The import dialog and the CLI read through `importAny`, and links through `decodeShareHash`. Rosters pass through `normalizeRoster` with its limits ([`import.ts`](../src/core/import.ts), [`parse-authors.ts`](../src/core/parse-authors.ts)). The lead's app re-checks a proof on every import instead of trusting a stored flag ([`ask.ts`](../src/core/ask.ts)) |
| Separation of privilege | Releases need a `v*` tag and the `npm-release` environment. Deploys need `main` and the `production` environment ([GOVERNANCE.md](../GOVERNANCE.md), [docs/deploy.md](deploy.md)) |
| Open design | The code, the CSP and the client id are public. The ORCID client id is public by design, because the implicit flow has no secret ([`orcid-proof.ts`](../src/core/orcid-proof.ts)) |
| Input validation at boundaries | Zod schemas on links, JSON files and every lookup response ([docs/architecture.md](architecture.md)) |

## Known weaknesses and residual risk

- **Analytics script.** The CSP allows Cloudflare's Web Analytics script. Like any script on the
  page, it can read a share link's fragment, and the ORCID `id_token` that sign-in returns in the
  fragment, before the app clears them ([SECURITY.md](../SECURITY.md#security-model)). A token signs
  one exact answer, so a copy of it proves nothing else.
- **`style-src 'unsafe-inline'`.** Kept for React style attributes
  ([`scripts/postbuild.mjs`](../scripts/postbuild.mjs)). Injected markup could still apply styles.
- **No CSP in development.** `next dev` does not read `public/_headers`
  ([ADR 0003](adr/0003-static-export.md)). CI runs the E2E suite against `wrangler dev`, which does.
- **Links are bearer secrets.** Anyone who holds a link can read it. Links end up in mail, chat and
  browser history, and nothing expires them.
- **Unsigned replies are not authenticated.** Without an ORCID sign-in, a reply could come from
  anyone who holds the ask link, with any answer. The lead settles each difference by hand.
- **Sign-in shows who, not whether they should.** A proof shows which ORCID account signed an
  answer. It does not show that this person is the contributor on the row. The Review tab flags a
  different iD, but a row without an iD gets no such warning.
- **No expiry check on the lead's side.** The token lives ten minutes, and the lead reads the reply
  later, so the lead's app checks the signature and nonce but not expiry
  ([`orcid-proof.ts`](../src/core/orcid-proof.ts)). A signed reply can be replayed, but only with the
  exact answer it signed.
- **Drafts are not encrypted at rest.** Anyone with access to the browser profile can read them
  ([SECURITY.md](../SECURITY.md#security-model)).
- **XML entities.** Browsers expand internal entities and the CLI does not, so one file can import
  different names in the app and in the CLI. Checked by hand on 2026-10-25: in Chromium, a file
  under the 1 MB cap that repeats one large internal entity blocks the page for about 13 seconds
  before the parse fails. Firefox and WebKit stop within half a second. Only a file the user picks
  reaches the parser, so the cost is a frozen tab, not lost data. See
  [Malicious imports](#malicious-imports).
- **The CLI has no size cap.** `credit-matrix` reads a whole file or stdin into memory
  ([`src/core/cli.ts`](../src/core/cli.ts)). It reads local input the user chose, so the risk is low.
- **Automerged dependency updates deploy.** Renovate merges minor and patch updates once checks pass,
  and a merge to `main` deploys ([`renovate.json5`](../renovate.json5)). The 7-day wait is the main
  guard against a hijacked release. The deploy step runs `wrangler` from the lockfile with the
  Cloudflare API token in its environment ([`ci.yml`](../.github/workflows/ci.yml)), so a hijacked
  `wrangler` or one of its dependencies could take that token.
- **Benchmarks hold an OIDC token.** The CodSpeed job runs census code from same-repo branches with
  an OIDC token for this repository ([`codspeed.yml`](../.github/workflows/codspeed.yml)). npm
  publishing and Cloudflare do not accept it: npm checks the release workflow and environment, and
  Cloudflare uses a stored secret.
- **One maintainer.** One person holds every key ([GOVERNANCE.md](../GOVERNANCE.md)), so no second
  person reviews changes, including security fixes.
- **No rate limiting of our own.** Each visitor's lookups count against the outside services' limits
  for their own address ([ADR 0003](adr/0003-static-export.md)).
- **Third-party services.** If ORCID's keys or its sign-in were compromised, proofs would mean
  nothing. Problems in ORCID, Crossref, DataCite and Cloudflare are out of scope
  ([SECURITY.md](../SECURITY.md#scope)).
