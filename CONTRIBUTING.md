# Contributing

Thanks for your interest in CRediT Matrix. Bug reports, fixes, and small
features are welcome.

## Getting set up

**Prerequisites:** Node ≥ 26, pnpm ≥ 11.

```bash
git clone https://github.com/simonvanlierde/credit-matrix
cd credit-matrix
pnpm install        # also installs the lefthook git hooks
pnpm dev            # → http://localhost:3000
```

## Where things live

- `src/core`: pure, framework-agnostic domain logic (statements, exports,
  validation, heatmap SVG). No React/Next/Node APIs at import time. Most changes
  and most tests belong here.
- the rest of `src/`: the Next.js UI, built as a static export.

[ADR&nbsp;0001](docs/adr/0001-client-side-architecture.md) records why it's split
this way.

## Before you open a PR

```bash
pnpm lint           # Biome (format + lint); append :fix to auto-fix
pnpm typecheck      # TypeScript
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright (optional locally)
```

CI runs `pnpm lint`, `pnpm typecheck`, and `pnpm test:coverage` on every PR.
Add or update tests in `src/core/__tests__` for any change to domain logic.

## Testing

- **Unit (Vitest)**: `pnpm test`. Covers the domain layer, the store, and `src/lib`: name
  parsing, initials deduplication, statement formats, score-to-level boundaries, import/export round
  trips, validation, and heatmap SVG generation.
- **End-to-end (Playwright)**: `pnpm test:e2e`. `happy-path.spec.ts` covers sample data, DOI and
  name import, the grid, and the client-side XML download. `sharing.spec.ts` covers share links and
  the co-author claim round trip. `drafts.spec.ts` covers deleting all drafts. `a11y.spec.ts` runs the axe scans. `messages.spec.ts`,
  `design-tokens.spec.ts`, and `offline.spec.ts` guard the locale catalogs, the design tokens, and
  the service worker.

Every PR runs Biome, typecheck, unit coverage, the full Playwright suite (including the axe scans),
and a static export build. In CI, Playwright runs against `wrangler dev`, which applies
`public/_headers`. Locally it uses `pnpm dev`, which has no CSP.

### Accessibility

Two automated checks guard the UI. They are guardrails, not a WCAG conformance claim.

| Check | Command | Scope | In CI |
| --- | --- | --- | --- |
| Biome [`a11y`](https://biomejs.dev/linter/rules/#accessibility) lint | `pnpm lint` | alt text, ARIA validity, button `type`, keyboard handlers | Every PR |
| [axe-core](https://github.com/dequelabs/axe-core-npm) scan ([`e2e/a11y.spec.ts`](e2e/a11y.spec.ts)) | `pnpm test:e2e` | WCAG 2.0/2.1 A/AA rules over the main screens, light + dark | Every PR |

The UI includes a skip link, landmark regions, radiogroup segmented controls, and a
`prefers-reduced-motion` fallback that neutralizes transitions and animations. Drag-to-reorder is
keyboard-accessible, and a live region announces copy, ORCID-lookup, and import status.

## Commit and PR conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  and are checked by commitlint (a `commit-msg` hook runs it locally).
- The lefthook hooks auto-format staged files on commit and run lint + tests on
  push, so most CI failures are caught before you push.
- Keep PRs focused. Describe the change and how you verified it.
