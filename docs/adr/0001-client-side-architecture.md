# 1. Client-side architecture with a framework-agnostic core

- Status: accepted; amended in part by [ADR 0002](0002-no-accounts-or-server-side-storage.md);
  the lookup proxies and the OpenNext deployment are superseded by [ADR 0003](0003-static-export.md)
- Date: 2026-06-29

## Context

The app, then named CRediT Generator, turns contributors and their roles into a
manuscript-ready statement, a heatmap, and machine-readable exports: JATS4R XML,
CSV, JSON, and Markdown. Every one of those is a pure transformation of data the
user types in. The app has no user account, no shared state between users, and
nothing worth persisting on a server. Its only external dependency is an ORCID
name lookup.

Three goals shaped the decision. The app should cost little to host. It should
run from a static bundle, so a reviewer can open it offline. And its
statement/export logic should be importable without the React UI, for a journal
or another tool that wants the domain layer alone.

## Decision

Keep the app **client-side only** and put all domain logic in a separate,
framework-agnostic package.

- `packages/core` holds every pure transformation: statement formats, exports,
  validation, XML import (native `DOMParser`), and the heatmap SVG. Its only
  runtime dependency is `zod`; it imports no React, Next, or Node APIs, so it
  runs unchanged in the browser and in Node-based tests.
- The Next.js app is a thin UI layer over `core`, with state in Zustand
  persisted to `localStorage`. No database, no backend session.
- The **one** server-side call is `/api/orcid`, a small Next.js route handler
  that proxies the ORCID public API. This exists only because that API sends no
  browser-friendly CORS headers, not because the lookup needs a server. A second
  proxy, `/api/doi`, was added later for the same reason; see ADR 0002.
- Contributions are stored as a `0–100` integer score rather than a boolean. The
  UI can offer a binary toggle or graded levels without changing the model or
  any export.
- Deployment targets Cloudflare Workers via OpenNext, matching the
  "no persistent server" shape.

## Consequences

**Good**

- Hosting is a static bundle plus one edge function, with no server to operate.
- `core` is independently testable (Vitest in Node) and reusable outside this UI.
- Privacy by default: contributor data never leaves the browser except the
  ORCID iD sent for a lookup.

**Trade-offs**

- No server means no server-side persistence or sharing. A draft is shared by
  encoding the whole state into a URL, so URL length bounds its size.
  [ADR 0002](0002-no-accounts-or-server-side-storage.md) later re-examined this
  trade-off and kept it, on data-protection grounds rather than cost.
- The ORCID proxy is a small server-side surface that must validate input (ORCID
  shape + checksum) before calling upstream.
- Node tests must supply a `DOMParser` (via `linkedom`) because `core` assumes
  the browser global for XML import.
