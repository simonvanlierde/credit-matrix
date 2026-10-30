# Assurance case

This answers the OpenSSF Best Practices criterion `assurance_case`, each claim linked to its
evidence. "Not verified" marks a claim I could not check here. To report a problem, see
[SECURITY.md](../SECURITY.md).

## Threat model

The project is the web app at <https://credit.duinlab.nl>, the `credit-matrix` npm package built
from [`src/core`](../src/core/README.md), and the census in [`census/`](../census/README.md).
There is no server, so there are no accounts, passwords or server-side drafts
([ADR 0002](adr/0002-no-accounts-or-server-side-storage.md), [ADR 0003](adr/0003-static-export.md)).

What could be harmed:

- **Drafts** in `localStorage`: co-authors' names, ORCID iDs and roles, unencrypted.
- **Share and reply links**, which carry a draft or one row in the URL fragment
  ([`share-link.ts`](../src/core/share-link.ts)).
- **ORCID proofs** in reply links ([`orcid-proof.ts`](../src/core/orcid-proof.ts)). A forged one
  would let someone answer in another person's name.
- **The npm package and CLI**, which other tools run.
- **The deployed files.** Tampered files run in every visitor's browser, and the service worker
  ([`public/sw.js`](../public/sw.js)) serves the last build offline.
- **The census outputs**: [`field-norms.json`](../src/data/field-norms.json) and the snapshot
  manifests and hashes ([census README](../census/README.md#what-makes-a-run-reproducible)).

Threats come from crafted links, files and names, forged replies, hijacked dependencies or CI
jobs, and the outside services. Attacks that need the user's device are out of
[scope](../SECURITY.md#scope).

## Trust boundaries

| Boundary | What crosses it | Treatment |
| --- | --- | --- |
| User's browser | All app code and drafts | Trusted |
| Static host (Cloudflare) | Built files, headers in [`_headers`](../public/_headers) | Trusted to serve what CI built. Runs no code of ours |
| ORCID | An iD out, a name back; sign-in; public signing keys | Schema-checked ([`orcid-lookup.ts`](../src/core/orcid-lookup.ts), [`orcid-proof.ts`](../src/core/orcid-proof.ts)) |
| Crossref, DataCite | A DOI out, metadata back | Schema-checked ([`doi-lookup.ts`](../src/core/doi-lookup.ts)) |
| Share and reply links | A draft or one row from someone else | Untrusted (T7, T8) |
| Imported files, pasted text | JATS XML, JSON, CSV, tenzing, name lists, statements | Untrusted ([`import.ts`](../src/core/import.ts), T4 to T6) |
| npm consumers | Users of the package or web element | They trust us. The element fetches any `src` the page gives it ([`element.ts`](../src/core/element.ts)) |
| Census inputs (PMC, Europe PMC, OpenAlex) | Article XML, journal fields | Untrusted (T14) |
| GitHub Actions, npm, Renovate | Code, dependencies, the release | Trusted with pins and narrow rights (T10 to T12) |

## Secure design principles

- **Economy of mechanism.** No server, accounts or database (ADR 0002, ADR 0003). `src/core` has
  one runtime dependency, `zod` ([architecture](architecture.md)).
- **Minimal attack surface.** No code runs per request. `connect-src` allows five outside hosts
  ([`_headers`](../public/_headers)).
- **Fail-safe defaults.** Bad links open the normal app (T7), bad proofs are dropped (T9), and the
  build fails rather than ship a wrong CSP (T2).
- **Least privilege.** CI starts at `contents: read` and only the jobs that need OIDC or secrets get
  them (T11). `Permissions-Policy` denies camera, microphone and geolocation.
- **Complete mediation.** Imports go through `importAny`, links through `decodeShareHash`, rosters
  through `normalizeRoster`. The lead's app re-checks a proof on every import instead of trusting a
  stored flag ([`ask.ts`](../src/core/ask.ts)).
- **Separation of privilege.** Releases need a `v*` tag and the `npm-release` environment; deploys
  need `main` and the `production` environment ([GOVERNANCE.md](../GOVERNANCE.md),
  [deploy](deploy.md)).
- **Open design.** Code, CSP and the ORCID client id are public. The implicit flow has no secret.

## Weaknesses countered

| # | Weakness | Counter | Evidence |
| --- | --- | --- | --- |
| T1 | XSS through rendering | React escapes text. The only raw HTML is a constant script. The web element's SVG passes every name and label through `escapeXml` | [`layout.tsx`](../src/app/layout.tsx), [`element.ts`](../src/core/element.ts), [`heatmap-svg.ts`](../src/core/export/heatmap-svg.ts) |
| T2 | Injected inline script | One CSP for the site: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`, `frame-ancestors 'none'`, narrow `connect-src`. The build swaps `'unsafe-inline'` in `script-src` for script hashes or fails. Also nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS | [`_headers`](../public/_headers), [`postbuild.mjs`](../scripts/postbuild.mjs) |
| T3 | Injection through exports | XML and SVG escape the five entities and drop characters XML cannot hold. CSV prefixes cells a spreadsheet could read as a formula | [`escape-xml.ts`](../src/core/export/escape-xml.ts), [`csv.ts`](../src/core/export/csv.ts) |
| T4 | Oversized input | 1 MB cap on files, pasted text and the element's fetch. Names capped at 500 characters, drafts at 200 contributors | [`author.ts`](../src/core/author.ts), [`ImportModal.tsx`](../src/components/ImportModal.tsx), [`parse-authors.ts`](../src/core/parse-authors.ts) |
| T5 | Malformed input | JSON through a Zod schema. Property tests feed random strings to `importAny` and random JSON to the share payload reader | [`json.ts`](../src/core/export/json.ts), [`properties.test.ts`](../src/core/__tests__/properties.test.ts) |
| T6 | XML entity attacks (XXE, billion laughs) | `fromJats4rXml` refuses any `<!ENTITY` (any case) before `DOMParser` (app) or linkedom (CLI, after a tag-balance check) runs | [`xml-import.ts`](../src/core/export/xml-import.ts), [`cli.ts`](../src/core/cli.ts), [`xml.test.ts`](../src/core/__tests__/xml.test.ts) |
| T7 | Malicious share link | Must match `#s=` plus base64url, with a length cap. Inflate stops at 1 MB. Payload must be version 2 with a consistent envelope. Scores clamp to 0 to 100. Failure opens the normal app | [`share-link.ts`](../src/core/share-link.ts), [`share-payload.ts`](../src/core/share-payload.ts) |
| T8 | Reply overwrites the lead's data | An ask link carries only one co-author's row. A reply sits beside the lead's row until settled by hand in Review | [`share-payload.ts`](../src/core/share-payload.ts), [ADR 0002](adr/0002-no-accounts-or-server-side-storage.md) |
| T9 | Forged ORCID proof | `nonce` is the SHA-256 of the reply payload. RS256 against ORCID's key set over HTTPS, issuer `https://orcid.org`, audience includes our client id. Random `state` in `sessionStorage`. The lead re-checks on arrival and on import, and keeps a proof only for that contributor and that answer. Review warns on a different iD. Any failure drops the proof | [`orcid-proof.ts`](../src/core/orcid-proof.ts), [`orcid-sign-in.ts`](../src/lib/orcid-sign-in.ts), [`ask.ts`](../src/core/ask.ts), [`ReviewPanel.tsx`](../src/components/ReviewPanel.tsx) |
| T10 | Hijacked dependency or action | Frozen `pnpm-lock.yaml` and `census/uv.lock`. pnpm refuses releases under 3 days old; Renovate and uv wait 7 days. Actions pinned by digest | [`ci.yml`](../.github/workflows/ci.yml), [`pnpm-workspace.yaml`](../pnpm-workspace.yaml), [`renovate.json5`](../renovate.json5), [`pyproject.toml`](../census/pyproject.toml) |
| T11 | Stolen CI credentials | Default `contents: read`. Four jobs can request OIDC: `attest`, `publish` and Scorecard run no project code; CodSpeed does (residual risk). Forks get no token and no Cloudflare secrets | [`codspeed.yml`](../.github/workflows/codspeed.yml), [`scorecard.yml`](../.github/workflows/scorecard.yml), [deploy](deploy.md) |
| T12 | Tampered build or release | Provenance attested for each deployed file. npm trusted publishing with `--provenance`, no stored token. Scorecard runs | [`release-core.yml`](../.github/workflows/release-core.yml), [`scorecard.yml`](../.github/workflows/scorecard.yml) |
| T13 | Data leaving the browser | No Worker code. Lookups send only the typed iD or DOI. Links use the fragment, cleared once read | [`HeaderActions.tsx`](../src/components/HeaderActions.tsx), [`_headers`](../public/_headers) |
| T14 | Hostile census XML | lxml with `resolve_entities=False`, `no_network=True`, no comments or processing instructions. Bulk files checked against committed SHA-256 hashes. Output reaches the app only as a committed JSON file of counts and shares, no names | [`jats.py`](../census/src/census/jats.py), [`rows.py`](../census/src/census/rows.py), [`bulk.py`](../census/src/census/bulk.py), [`field-norms.ts`](../src/lib/field-norms.ts) |

## Residual risk

- **Undeclared entity references** such as `&eacute;`. linkedom keeps them as text; what each
  browser's `DOMParser` does is not verified, so the app and CLI may read a name differently.
- **Previews hold a Cloudflare token.** The `preview` job runs a same-repo pull request's `wrangler`
  (Renovate's included) with the `preview` token, and that environment has no branch rule. What the
  token can do beyond uploading a preview is not verified.
- **Deploy holds a Cloudflare token.** Renovate automerges minor and patch updates and `main`
  deploys, so a hijacked `wrangler` or dependency could take the token. The 7-day wait is the guard.
- **Benchmarks hold an OIDC token.** CodSpeed runs census code from same-repo branches with it. npm
  and Cloudflare do not accept it.
- **The CLI bundles `zod` and linkedom**, so their fixes reach CLI users only in a new release
  ([`tsdown.config.ts`](../src/core/tsdown.config.ts)). The CLI has no size cap, but reads only
  local input.
- **Unsigned replies are not authenticated.** A proof shows which ORCID account signed, not that it
  is the row's contributor, and a row without an iD gets no warning.
- **No expiry check on the lead's side.** The token lives ten minutes, so a signed reply can be
  replayed, but only with the exact answer it signed.
- **`style-src 'unsafe-inline'`** stays for React style attributes, so injected markup could style.
- **No CSP under `next dev`.** CI runs E2E against `wrangler dev`, which applies it.
- **Links are bearer secrets and drafts are unencrypted**
  ([SECURITY.md](../SECURITY.md#security-model)). Nothing expires a link.
- **Outside services.** No rate limiting of our own; lookups count against each visitor's limits.
  A compromised ORCID would make proofs meaningless.
- **One maintainer** holds every key, so nobody else reviews changes
  ([GOVERNANCE.md](../GOVERNANCE.md)).
