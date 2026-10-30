# Contributing

Bug reports, fixes, and small features are all welcome. [PRODUCT.md](PRODUCT.md) says what the app
is for, [DESIGN.md](DESIGN.md) holds the design rules UI changes have to follow, and
[docs/architecture.md](docs/architecture.md) says where things live. I record design decisions in
[docs/adr](docs/adr/).

To report a bug, open an [issue](https://github.com/simonvanlierde/credit-matrix/issues) and say
what you did, what you expected, what happened, and which version or URL you used. Report a
vulnerability as [SECURITY.md](SECURITY.md) says, not in an issue.

## Getting set up

**Prerequisites:** Node ≥ 26, pnpm ≥ 11.

```bash
git clone https://github.com/simonvanlierde/credit-matrix
cd credit-matrix
pnpm install        # also installs the lefthook git hooks
pnpm dev            # → http://localhost:3000
```

## Build from source

```bash
pnpm install --frozen-lockfile   # the exact versions in pnpm-lock.yaml
pnpm build                       # the credit-matrix package in src/core/dist, then the static site in out/
pnpm preview                     # serve out/ with wrangler, under the production headers
```

To build only the npm package, run `pnpm --filter credit-matrix build`. `pnpm verify` builds the
package and runs the checks the pre-push hook runs. CI adds the site build, the e2e suite and JATS
validation.

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

## Dependencies

I add a dependency only when it saves real work, is maintained, and has a license compatible with
MIT. The browser bundle stays small, so prefer the platform or a few lines of code over a new
package. `pnpm-lock.yaml` pins every version; commit it with any change to `package.json`. CI
installs with `--frozen-lockfile`, so a stale lockfile fails. pnpm refuses releases younger than 3 days
(`minimumReleaseAge` in `pnpm-workspace.yaml`). Renovate proposes updates once a month and waits 7
days after a release before it does (`minimumReleaseAge` in `renovate.json5`), so a hijacked release
has time to be pulled. It merges minor and patch updates once every check passes; majors wait for
me. The census in `census/` follows the same rule through uv's `exclude-newer = "7 days"`.

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
- **Mutation tests**: `pnpm mutation` runs [StrykerJS](https://stryker-mutator.io) on the import
  and export code in `src/core` (`export/`, `import.ts`, `share-payload.ts`, `parse-authors.ts`
  and `statement.ts`). It changes the code one small edit at a time and runs the `core` tests
  against each change, to find code the tests run but do not check. It scores 89.5%: 2,194 of
  2,452 mutants are killed, and the header of `test/mutation-baseline.txt` keeps the current
  score. It takes about 4 minutes with its 8 workers, so CI does not run it. Run
  it on the Node version in `.node-version`: another version moves the score by about half a point. It
  writes an HTML report to `reports/mutation/` and the mutants no test kills to
  `test/mutation-baseline.txt`. Commit that list with your change, and look at what the diff
  adds: a new survivor is a test to write, or a change that does nothing. A survivor no test can
  tell apart keeps its reason after `  # kept: ` at the end of its line, and the next run keeps it.
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
- Sign off every commit, as the next section says.

## Sign off your commits

Every commit in a pull request carries a `Signed-off-by:` line, which says you wrote the change
or have the right to submit it under the MIT license: the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). `git commit -s` adds
it, and the lefthook `prepare-commit-msg` hook adds it for you once `pnpm install` has set the hooks up.
`git rebase --signoff upstream/main` (the branch you started from) adds it to commits you already made.
The `dco` workflow fails any pull request with a commit that lacks it; commits by bots are skipped.

## Who maintains this

[GOVERNANCE.md](GOVERNANCE.md) says who decides, who has access, and what happens if the
maintainer stops.

Deploys and rollback are in [docs/deploy.md](docs/deploy.md).
