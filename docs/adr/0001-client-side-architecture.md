# 1. Client-side architecture with a framework-agnostic core

- Status: accepted; amended in part by [ADR 0002](0002-no-accounts-or-server-side-storage.md);
  the lookup proxies and the OpenNext deployment are superseded by [ADR 0003](0003-static-export.md)
- Date: 2026-06-29

## Context

The app, then named CRediT Generator, turns contributors and their roles into a
statement for the manuscript, a heatmap, and exports for software: JATS4R XML,
CSV, JSON, and Markdown. Each of those is computed from data the user types in,
with nothing else involved. The app has no user account, no shared state between
users, and nothing worth persisting on a server. The only outside service it
calls is an ORCID name lookup.

I had three goals. The app should cost little to host. It should run from a
static bundle, so a reviewer can open it offline. And a journal or another tool
should be able to import the statement and export logic without the React UI.

## Decision

Keep the app **client-side only**, and put all domain logic in a separate
package that doesn't depend on any framework.

- `packages/core` holds everything that only turns input into output: statement
  formats, exports, validation, XML import (with the browser's own `DOMParser`),
  and the heatmap SVG. Its only runtime dependency is `zod`. It imports no React,
  Next, or Node APIs, so it runs unchanged in the browser and in tests under Node.
- The Next.js app is a thin UI on top of `core`. Its state lives in Zustand and
  is saved to `localStorage`. There is no database and no session on a server.
- The **one** server-side call is `/api/orcid`, a small Next.js route handler
  that passes requests on to the ORCID public API. It exists only because that
  API sends no CORS headers that let a browser call it, not because the lookup
  needs a server. A second proxy, `/api/doi`, came later for the same reason;
  see ADR 0002.
- Contributions are stored as a `0–100` integer score, not as a yes/no value.
  The UI can offer a yes/no toggle or levels without changing the model or any
  export.
- The app deploys to Cloudflare Workers through OpenNext, which fits having no
  server that keeps running.

## Consequences

**Good**

- Hosting is a static bundle plus one edge function, with no server to run.
- `core` can be tested on its own (Vitest in Node) and reused outside this UI.
- Private by default: contributor data never leaves the browser, except the
  ORCID iD sent for a lookup.

**Trade-offs**

- No server means nothing is stored or shared on a server. To share a draft,
  the app encodes the whole state into a URL, so the URL length limits how big
  a draft can be. [ADR 0002](0002-no-accounts-or-server-side-storage.md) later
  looked at this trade-off again and kept it, for data protection rather than
  cost.
- The ORCID proxy is a small piece of server code. It must check its input
  (ORCID shape and checksum) before it calls ORCID.
- Node tests must supply a `DOMParser` (via `linkedom`), because `core` expects
  the browser's global one for XML import.
