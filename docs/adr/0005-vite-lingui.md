# 5. Vite, React and Lingui catalogs

- Status: accepted
- Date: 2026-11-07
- Supersedes: the frontend framework and translation runtime in [ADR 0001](0001-client-side-architecture.md),
  and the Next.js build in [ADR 0003](0003-static-export.md)

## Context

The application has a fixed set of static pages and browser-managed drafts. It needs a client
bundle, prerendered pages for search engines, and a standard catalog format for translation checks.

## Decision

Use Vite to build the React application and prerender each public route at build time. Serve the
resulting `out/` directory through the existing Cloudflare static-assets deployment. A service worker
precaches the app's routes and language chunks, including routes the visitor has not opened yet.

Store interface and output translations in separate Lingui PO catalogs. Compile them before builds
and tests. The published package retains its translation interfaces, backed by those compiled catalogs.
Browser-element and standalone MyST bundles include the translation runtime they need.

## Consequences

Public routes, page metadata and persisted draft formats remain stable. The build includes a small
prerender step and a catalog compiler. Generated TypeScript catalogs are ignored; contributors edit PO files.

Citation-file imports use citesync in a worker only when requested. The worker's response has a separate
CSP that permits the pinned Pyodide runtime from jsDelivr. Pages retain their own restricted script
policy. Input files remain in the browser; direct CodeMeta imports work offline.
