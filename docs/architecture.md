# Architecture

It's all TypeScript: one Next.js app, built as a static export, with the logic that doesn't depend
on React or Next.js in `src/core`. There is no server code.

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 (App Router) | Static export on Cloudflare, no server code |
| Styling | Tailwind CSS v4 | Design tokens via `@theme`; no runtime CSS |
| State | Zustand + immer + persist | Survives a refresh via localStorage |
| Validation | Zod | Schema checks at trust boundaries |
| Heatmap | Hand-crafted SVG (`core`) | One SVG source feeds both download and canvas PNG |
| Offline | Service worker + manifest | Precaches the app's own files under a per-build cache name |

```text
Browser
  └─ Next.js app  (repo root, App Router)
       ├─ React UI + Zustand store (persisted to localStorage)
       ├─ src/core   ← all domain logic, runs in the browser
       │     statements · JATS4R XML · Crossref XML · CSV · tenzing CSV · JSON · Markdown · heatmap SVG · validation
       ├─ ORCID and DOI lookups ──→ pub.orcid.org · api.crossref.org · api.datacite.org
       └─ ORCID sign-in on replies ──→ orcid.org (sign-in page, public keys)
                                     ← the only calls that leave the browser
```

## `src/core`

[`src/core`](../src/core/README.md) holds the domain logic (statements, exports, validation, heatmap
SVG) as plain TypeScript with no side effects, and `zod` is its only runtime dependency. It is
published as the `credit-matrix` npm package, with a CLI (`cli.ts`) and a web element
(`element.ts`). Apart from the CLI, it uses no React, Next.js or Node APIs when it's imported. Biome
refuses imports there of React, Next.js, `@/`, or relative paths that leave `src/core`. Most changes
and most tests go here. XML import uses the browser's own `DOMParser`, and the PNG is drawn from the
heatmap SVG onto a `<canvas>`.

Each contribution stores a 0–100 integer `score`, not a yes/no value, so the UI can switch between
yes/no and levels without changing what is stored. The
[domain model](../src/core/README.md#domain-model) has the score range of each level.
[ADR 0001](adr/0001-client-side-architecture.md) explains the split.

## Lookups and the CSP

The ORCID and DOI lookups call the public APIs of ORCID, Crossref and DataCite straight from the
browser. DataCite is only asked about DOIs that Crossref does not hold, such as arXiv and Zenodo
records. All three send CORS headers that let the browser call them. The Content Security Policy
(CSP) in [`public/_headers`](../public/_headers) allows exactly those origins, plus `orcid.org`, whose
public keys check a co-author's ORCID sign-in on a reply.

## No accounts, no server-side storage

A draft holds the names and ORCID iDs of co-authors who never visited this site. So the draft stays
in your browser, and I have nothing to delete when someone asks. To move a draft to another device,
export it as JSON. [ADR 0002](adr/0002-no-accounts-or-server-side-storage.md) says what would have
to change before I revisit this.
