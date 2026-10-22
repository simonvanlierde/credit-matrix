# Contributing

Bug reports, fixes, and small features are all welcome. [PRODUCT.md](PRODUCT.md) says what the app
is for, [DESIGN.md](DESIGN.md) holds the design rules UI changes have to follow, and
[docs/architecture.md](docs/architecture.md) says where things live. I record design decisions in
[docs/adr](docs/adr/).

## Getting set up

**Prerequisites:** Node ≥ 26, pnpm ≥ 11.

```bash
git clone https://github.com/simonvanlierde/credit-matrix
cd credit-matrix
pnpm install        # also installs the lefthook git hooks
pnpm dev            # → http://localhost:3000
```

## Before you open a PR

```bash
pnpm lint           # Biome (format + lint); append :fix to auto-fix
pnpm typecheck      # TypeScript, plus the CLI's modules checked again without the DOM types
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright (optional locally)
pnpm verify         # build the package, then lint, typecheck, and unit tests under the coverage gate (also the pre-push hook)
pnpm validate:jats  # check the JATS fixture, the conformance cases and a fresh export against the JATS 1.3 DTD and JATS4R rules (needs xmllint)
```

Before the first e2e run, install the browser: `pnpm exec playwright install chromium`. The first
`pnpm validate:jats` downloads the JATS4R rules and SchXslt2 into `.cache/` and compiles them,
which takes about 1.5 minutes. Later runs reuse the cache.

CI runs `pnpm verify`, `pnpm validate:jats`, the full Playwright suite (with the axe scans) and a
static export build on every pull request and every push to `main`. It deploys `main` only when all
of them pass. If you change the domain logic, add or update tests in `src/core/__tests__`.

The CRediT census in `census/` is a Python project with its own checks, which `pnpm verify` does
not run. It needs [uv](https://docs.astral.sh/uv/); the pre-push hook runs these when census files
change:

```bash
cd census && uv run --locked ruff format --check . && uv run --locked ruff check . && uv run --locked ty check && uv run --locked pytest -q
```

`census/tests/corpus.jsonl` pins the statement parser's output on 60 real statements, so any change
in what it reads fails a test. After a change you meant to make, review the diff and rewrite the
expected output with `CENSUS_UPDATE_CORPUS=1 uv run pytest -q tests/test_corpus.py`.

`census/tests/test_benchmarks.py` times the parser on that corpus and on two JATS articles. A plain
`pytest` runs each once; on every pull request [CodSpeed](https://codspeed.io) measures them and
comments when one gets slower or faster than on main.

## Testing

- **Unit (Vitest)**: two projects. `core` runs `src/core` under Node and checks the built package:
  its exports, the type snapshot and the CLI. `app` runs the rest under jsdom. If you change the
  package's interface on purpose, update the snapshots with `pnpm exec vitest run --project core -u`.
- **Format fixtures**: `format-fixtures.test.ts` decodes saved files in
  `src/core/__tests__/fixtures/` that never change (a share link, JSON, CSV and JATS). If you change
  a format on purpose, regenerate the fixture it affects and run `pnpm validate:jats`.
- **Property tests**: `properties.test.ts` feeds random drafts through every format and random text
  to the importers, with [fast-check](https://fast-check.dev). A failure prints the seed and the
  smallest input that fails: add that input as a fixed test next to the fix.
- **Watch mode**: Vitest's global setup builds the package's `dist/` once, when Vitest starts. In
  watch mode (`pnpm exec vitest`) it is not rebuilt, so after editing `src/core`, restart Vitest
  before trusting the package tests.
- **Quarto**: the rendered Quarto test (`integrations/quarto/credit-matrix.test.ts`) needs `quarto`
  on your `PATH` and is skipped without it. CI installs Quarto, so it always runs there.
- **End-to-end (Playwright)**: the specs in `e2e/`. In CI they run against `wrangler dev`, which
  applies `public/_headers`. On your machine they use `pnpm dev`, which has no Content Security
  Policy (CSP). You only need [wrangler](https://developers.cloudflare.com/workers/wrangler/) for
  `pnpm preview` and `pnpm deploy`.
- **Accessibility**: Biome's a11y lint and the axe scans in `e2e/a11y.spec.ts` catch common
  mistakes. They don't mean the app meets WCAG. The
  [accessibility statement](docs/accessibility.md) says what they cover.

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
4. Add the locale to `LOCALES` in `scripts/fetch-credit-translations.mjs` and run the script, then
   add both new files to the import maps in `credit-i18n/index.ts` and `credit-i18n/ui-strings.ts`. This
   only works if upstream already has that language. If it does not, translate the roles upstream
   first.

`pnpm exec playwright test e2e/messages.spec.ts` checks the catalogs: a language in the picker with
no catalog files, keys that differ from English, broken ICU syntax, or a missing placeholder fails
it.

To report a wrong or missing translation without a PR, use the translation issue form.

## Commit and PR conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/). commitlint checks
  them in a `commit-msg` hook.
- The lefthook hooks format staged files when you commit, and run `pnpm verify` when you push.
- Keep each PR to one change. Say what it changes and how you checked it.

Deploys and rollback are in [docs/deploy.md](docs/deploy.md).
