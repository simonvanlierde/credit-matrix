# Contributing

Bug reports, fixes, and small features are all welcome. This page has what you
need to get set up and get a change in.

## Getting set up

**Prerequisites:** Node ≥ 26, pnpm ≥ 11.

```bash
git clone https://github.com/simonvanlierde/credit-matrix
cd credit-matrix
pnpm install        # also installs the lefthook git hooks
pnpm dev            # → http://localhost:3000
```

## Where things live

- `src/core`: the domain logic (statements, exports, validation, heatmap SVG),
  as plain TypeScript with no side effects. It uses no React, Next.js or Node
  APIs when it's imported. Most changes and most tests go here.
- the rest of `src/`: the Next.js UI, built as a static export.

[ADR&nbsp;0001](docs/adr/0001-client-side-architecture.md) explains why I split
it this way.

## Before you open a PR

```bash
pnpm lint           # Biome (format + lint); append :fix to auto-fix
pnpm typecheck      # TypeScript
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright (optional locally)
pnpm verify         # lint, typecheck, and unit tests under the coverage gate (also the pre-push hook)
pnpm validate:jats  # check the JATS export against the JATS 1.3 DTD and JATS4R rules (needs xmllint)
```

Before the first e2e run, install the browser: `pnpm exec playwright install chromium`.

CI runs on every pull request and on every push to `main`. It runs `pnpm verify`,
`pnpm validate:jats`, the e2e suite and a build. It deploys `main` only when all of them pass.
If you change the domain logic, add or update tests in `src/core/__tests__`.

## Testing

- **Unit (Vitest)**: `pnpm test`. Covers the domain layer, the store, and `src/lib`: name
  parsing, removing duplicate initials, statement formats, which score maps to which level, exporting
  and importing back, validation, and the heatmap SVG. `format-fixtures.test.ts` decodes saved files
  in `src/core/__tests__/fixtures/` that never change (a share link, JSON, CSV and JATS). If you
  change a format on purpose, regenerate the fixture it affects and run `pnpm validate:jats`.
- **End-to-end (Playwright)**: `pnpm test:e2e`. `happy-path.spec.ts` covers sample data, DOI and
  name import, the grid, and the client-side XML download. `sharing.spec.ts` covers share links and
  the co-author claim round trip. `review.spec.ts` covers settling co-author answers in the Review
  tab, with its own axe scan. `drafts.spec.ts` covers deleting all drafts. `a11y.spec.ts` runs the
  axe scans. `messages.spec.ts`, `design-tokens.spec.ts`, and `offline.spec.ts` guard the locale
  catalogs, the design tokens, and the service worker.

Every PR runs Biome, typecheck, the unit tests with coverage, the full Playwright suite (with the
axe scans), and a static export build. In CI, Playwright runs against `wrangler dev`, which applies
`public/_headers`. On your machine it uses `pnpm dev`, which has no Content Security Policy (CSP).
You only need [wrangler](https://developers.cloudflare.com/workers/wrangler/) for `pnpm preview` and
`pnpm deploy`. You don't need it to develop or to run the tests locally.

### Accessibility

Two automated checks guard the UI. They catch common mistakes. They don't mean the app meets WCAG,
the web accessibility guidelines.

| Check | Command | Scope | In CI |
| --- | --- | --- | --- |
| Biome [`a11y`](https://biomejs.dev/linter/rules/#accessibility) lint | `pnpm lint` | alt text, ARIA validity, button `type`, keyboard handlers | Every PR |
| [axe-core](https://github.com/dequelabs/axe-core-npm) scan ([`e2e/a11y.spec.ts`](e2e/a11y.spec.ts)) | `pnpm test:e2e` | WCAG 2.0/2.1/2.2 A/AA rules over the main screens, light + dark | Every PR |

The UI has a skip link, landmark regions, and segmented controls built as radio groups. With
`prefers-reduced-motion` set, transitions and animations are switched off. You can reorder by
keyboard as well as by dragging. A live region tells screen readers how a copy, an ORCID lookup or
an import went.

## Translating

The app has nine languages. Where a translation lives depends on the text, in one of three places.

| What | File | Notes |
| --- | --- | --- |
| Interface text (buttons, labels, dialogs) | `src/messages/<locale>.json` | ICU messages. `en.json` is the source. |
| Statement and heatmap text ("Acknowledgements", contribution levels, empty-state line) | `src/core/credit-i18n/ui/<locale>.json` | Holds only overrides. A missing key falls back to English. |
| CRediT role names and descriptions | `src/core/credit-i18n/translations/<locale>.json` | Vendored from [contributorshipcollaboration/credit-translation](https://github.com/contributorshipcollaboration/credit-translation). Do not edit it here. Fix the role name upstream, then refresh with `node scripts/fetch-credit-translations.mjs` and review the diff. |

Locale codes are BCP 47 tags, such as `pt-PT` and `zh-Hans`.

**Add a language**

1. Add `{ code, name }` to `AVAILABLE_LOCALES` in `src/core/credit-i18n/index.ts`. The name is the
   language's own name for itself.
2. Add `src/messages/<code>.json` with every key from `en.json`.
3. Add `src/core/credit-i18n/ui/<code>.json`, copying the keys from an existing locale.
4. Add the locale to `LOCALES` in `scripts/fetch-credit-translations.mjs` and run the script. This
   only works if upstream already has that language. If it does not, translate the roles upstream
   first.

**The check.** `e2e/messages.spec.ts` fails in four cases:

- a language in the picker has no catalog files;
- a catalog has keys that English lacks, or lacks keys that English has;
- the ICU syntax is broken;
- a placeholder is missing.

Run it with `pnpm exec playwright test e2e/messages.spec.ts`.

To report a wrong or missing translation without a PR, use the translation issue form.

## Deploys and rollback

See [docs/deploy.md](docs/deploy.md).

## Commit and PR conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
  commitlint checks them, and a `commit-msg` hook runs it on your machine.
- The lefthook hooks format staged files when you commit, and run lint and
  tests when you push. So most CI failures show up before you push.
- Keep each PR to one change. Say what it changes and how you checked it.
