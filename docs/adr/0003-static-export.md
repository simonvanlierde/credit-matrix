# 3. Static export, lookups from the browser

- Status: accepted
- Date: 2026-09-30
- Supersedes: the `/api/orcid` and `/api/doi` proxies and the OpenNext deployment in
  [ADR 0001](0001-client-side-architecture.md)

## Context

The app ran as a Next.js server on Cloudflare Workers through OpenNext. The server was only there
for two lookup proxies and a `/health` route. The page itself was already prerendered.

That server failed in production. About once an hour, a new Worker instance went over its resource
limit while it loaded the OpenNext bundle. For a minute or two the site then answered `503` with
Cloudflare error 1102. An uptime probe caught it 13 times in one day.

The reason for the proxies was also wrong. ORCID's public API does send
`Access-Control-Allow-Origin: *`, as Crossref's does, so the browser can call both directly.

## Decision

Build with `output: "export"` and serve `out/` as Cloudflare Workers static assets, with no Worker
code. The browser calls `pub.orcid.org` and `api.crossref.org` itself. It also calls
`api.datacite.org` for DOIs that Crossref does not hold (arXiv, Zenodo). The CSP's `connect-src`
names those origins. Response headers move from `next.config.ts` to `public/_headers`. `/health`
becomes a static `/health.json` that holds the build's commit. (I later removed that file, and the
check after each deploy that read it. Uptime monitoring shows whether the site is up, and CI builds
exactly what gets deployed.)

## Consequences

**Good**

- No code runs per request, so there is no cold start and no resource limit to exceed.
- One dependency (`@opennextjs/cloudflare`), the rate limiter, and both route handlers are gone.
- Any static host can serve the app.

**Trade-offs**

- No rate limiter of our own. Each visitor's lookups count against the ORCID, Crossref, and DataCite
  limits for their own address, not ours.
- The contact address for Crossref's "polite pool" (the faster lane for callers who give an email)
  ships in the client bundle. It is a public address anyway.
- `next dev` does not read `public/_headers`, so the dev server runs without a CSP. CI runs the E2E
  suite against `wrangler dev`, which applies it.
