# 3. Static export, lookups from the browser

- Status: accepted
- Date: 2026-09-30
- Supersedes: the `/api/orcid` and `/api/doi` proxies and the OpenNext deployment in
  [ADR 0001](0001-client-side-architecture.md)

## Context

The app ran as a Next.js server on Cloudflare Workers through OpenNext, only to host two lookup
proxies and a `/health` route. The page itself was already prerendered.

That server failed in production. About once an hour, a fresh Worker instance booting the OpenNext
bundle exceeded its resource limit, and for a minute or two the site answered `503` with Cloudflare
error 1102. An uptime probe caught it 13 times in one day.

The proxies' premise was also wrong: ORCID's public API does send
`Access-Control-Allow-Origin: *`, as Crossref's does, so the browser can call both directly.

## Decision

Build with `output: "export"` and serve `out/` as Cloudflare Workers static assets, with no Worker
code. The browser calls `pub.orcid.org` and `api.crossref.org` itself, plus `api.datacite.org` for DOIs
Crossref does not hold (arXiv, Zenodo); the CSP's `connect-src` names those origins. Response headers move from `next.config.ts` to `public/_headers`, and
`/health` becomes a static `/health.json` carrying the build's commit.

## Consequences

**Good**

- No code runs per request, so there is no cold start and no resource limit to exceed.
- One dependency (`@opennextjs/cloudflare`), the rate limiter, and both route handlers are gone.
- Any static host can serve the app.

**Trade-offs**

- No rate limiter of our own. Each visitor's lookups count against ORCID's, Crossref's and DataCite's limits
  for their own address, not ours.
- The Crossref polite-pool contact address ships in the client bundle. It is a public address.
- `next dev` does not read `public/_headers`, so the dev server runs without a CSP. The E2E suite
  runs against `wrangler dev`, which applies it.
