# Contributing

Bug reports, fixes, and small features are all welcome. [PRODUCT.md](PRODUCT.md) says what the app
is for, [DESIGN.md](DESIGN.md) holds the design rules UI changes have to follow, and
[docs/architecture.md](docs/architecture.md) says where things live. I record design decisions in
[docs/adr](docs/adr/).

To report a bug, open an [issue](https://github.com/simonvanlierde/credit-matrix/issues) and say
what you did, what you expected, what happened, and which version or URL you used. Report a
vulnerability as [SECURITY.md](SECURITY.md) says, not in an issue.

## Getting set up

**Prerequisites:** Node ≥ 26, pnpm 12.

```bash
git clone https://github.com/simonvanlierde/credit-matrix
cd credit-matrix
pnpm install        # also installs the lefthook git hooks
pnpm dev            # → http://localhost:5173
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
pnpm validate:crossref  # check a fresh Crossref export against the Crossref schema 5.5.0 (needs uv)
```

Before the first e2e run, install the browsers: `pnpm exec playwright install chromium firefox webkit`
(add `--with-deps` on Linux). `pnpm test:e2e` runs all three; add `--project=firefox` to run one. The first
`pnpm validate:jats` downloads the JATS4R rules and SchXslt2 into `.cache/` and compiles them,
which takes about 1.5 minutes. Later runs reuse the cache.

CI runs `pnpm verify`, `pnpm validate:jats`, `pnpm validate:crossref`, the full Playwright suite (with the axe scans)
and a static export build. Pull requests run the Playwright suite in Chromium; pushes to `main` and a
weekly run add Firefox and WebKit. A pull request that changes only `census/` skips the web jobs. CI
deploys `main` only when all of them pass.

If you change the domain logic, add or update tests in `src/core/__tests__`.

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
`pytest` runs each once; on pull requests that touch `census/` or `src/core/`, [CodSpeed](https://codspeed.io) measures them and
comments when one gets slower or faster than on main.

## Dependencies

I add a dependency only when it saves real work, is maintained, and has a license compatible with
MIT. Prefer the platform or a few lines of code over a new package. After a build, `pnpm check:bundle`
checks separate gzip budgets for the app and its figure exporter. `pnpm-lock.yaml` pins every
version; commit it with any change to `package.json`. CI installs with `--frozen-lockfile`, so a
stale lockfile fails. pnpm refuses releases younger than 3 days (`minimumReleaseAge` in
`pnpm-workspace.yaml`). Renovate proposes updates every Monday and waits 7 days after a release
before it does (`minimumReleaseAge` in `renovate.json5`), so a hijacked release has time to be
pulled. It merges minor and patch updates once every check passes; majors and GitHub Actions updates wait for me. The census in
`census/` follows the same rule through uv's `exclude-newer = "7 days"`.

## Releases

Add a dated changelog entry before running `pnpm version`: rename `## [Unreleased]` to
`## [<version>] - <date>` above a new empty `## [Unreleased]`, and at the bottom of the file point
the `[Unreleased]` link at `compare/v<version>...HEAD` and add a `[<version>]` link to
`compare/v<previous>...v<version>`. Its lifecycle script takes the
version from the root package and the date from that entry. It runs `citesync==0.4.0` through
`uvx` to update CITATION.cff, codemeta.json, the four committed citation exports (including
`schema.jsonld`) and the published `src/core/package.json`.
The first run needs access to the Python package index; later runs can use uv's cache.

[citesync.toml](citesync.toml) lists those files and permits only version writes to the package.
The release script supplies a temporary source with only version and date, so it does not
replace names, roles or other metadata. It still updates Quarto's extension version itself.
`citesync check` checks the citation files against CITATION.cff and the published package;
the private root package supplies the release version and is not a citation target.
`scripts/sync-citation.sh` also rewrites the unpkg version in `integrations/myst/README.md` and
`integrations/jupyter-book/README.md`.

A metadata error stops the script before staging files or updating Quarto. Some citation or
package version fields may already have changed. Fix the reported file, then run `pnpm run version`
to finish syncing the current version without another version bump.

Before tagging, review the whole change since the previous tag, then run `pnpm verify`,
`pnpm mutation`, `pnpm validate:jats` and `pnpm validate:crossref`. Check the citation abstract,
title and keywords against the README and GitHub About text. Merge the release PR before
creating its signed version tag on main; the tag starts the npm publishing workflow described in
[deployment](docs/deploy.md#the-npm-package).

Use `git tag -s v<version> -m "v<version>"` with your configured signing key, then check it with
`git verify-tag v<version>` before pushing the tag. Do not create release tags through GitHub's web interface.

After npm publishing succeeds, the workflow prepares a draft GitHub release with the npm tarball,
its provenance bundle and an attested CycloneDX SBOM. Review the draft's notes and assets, then
publish it for the Zenodo archive. Enable immutable releases in the repository's
**Settings → General → Releases** before the next release: published assets and tags then cannot change.
Zenodo copies `.zenodo.json`, or `CITATION.cff` when that file is absent, when the GitHub release
is published. Later metadata edits do not update that archived version.

The Typst package goes to [Typst Universe](https://typst.app/universe/package/credit-matrix)
through a PR to [typst/packages](https://github.com/typst/packages), only for a plain
`major.minor.patch` version (the release script leaves `typst.toml` alone for a pre-release).
Copy `integrations/typst` to `packages/preview/credit-matrix/<version>/` there, without
`credit-matrix.test.ts` and `out/`, and make two changes in the copy: the examples import
`@preview/credit-matrix:<version>` instead of `../lib.typ`, and the README's CREDITS.md link
points at the `v<version>` tag instead of `main`.

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
  against each change, to find code the tests run but do not check. The header of
  `test/mutation-baseline.txt` keeps the current score. It takes about 4 minutes with its 8
  workers, so pull requests do not run it; the Mutation workflow runs it weekly, and from the
  Actions tab with "Run workflow". It fails on a survivor the list does not have, and only warns
  when the runner kills a listed one (it times out on some mutants a local run lets live). Run it on
  the Node version in `.node-version`: another version moves the score by about half a point. It
  writes an HTML report to `reports/mutation/` and the mutants no test kills to
  `test/mutation-baseline.txt`. Commit that list with your change, and look at what the diff
  adds: a new survivor is a test to write, or a change that does nothing. A survivor no test can
  tell apart keeps its reason after `  # kept: ` at the end of its line, and the next run keeps it.
- **Watch mode**: Vitest's global setup builds the package's `dist/` once, when Vitest starts. In
  watch mode (`pnpm exec vitest`) it is not rebuilt, so after editing `src/core`, restart Vitest
  before trusting the package tests.
- **Memory**: `vitest.config.ts` caps each worker at 4 GB of heap and runs 4 at once. A test that
  reads a stream or loops on input gives it an end, so a regression fails instead of filling memory.
- **Document integrations**: `pnpm test:integrations` runs real Pandoc, Sphinx, MyST and Jupyter
  Book builds. It needs uv, and it builds the workspace package first.
  Python tools and Pandoc are locked in `integrations/uv.lock`; the two book CLIs are devDependencies.
  The MyST plugin ships in the npm package as `dist/myst-plugin.mjs`, built by
  `src/core/tsdown.config.ts`.
  `pnpm verify` includes these builds and checks the Python extension and tests with Ruff and ty.
- **Quarto**: the rendered Quarto test (`integrations/quarto/credit-matrix.test.ts`) needs `quarto`
  on your `PATH` and is skipped without it. CI installs Quarto, so it always runs there.
- **Typst and Quarto**: generated translations come from the app's catalogs. After changing them, run
  `pnpm --filter credit-matrix build && node scripts/build-typst-translations.mjs && node scripts/build-quarto-translations.mjs`.
  The Quarto test checks every generated role name, label and heading against its source catalog.
  The Typst test (`integrations/typst/credit-matrix.test.ts`) fails when the file is stale. With
  `typst` on your `PATH` it also compiles the examples and checks the statement text against the
  app's; it is skipped without Typst, and CI installs it.
- **End-to-end (Playwright)**: the specs in `e2e/`. In CI they run against `wrangler dev`, which
  applies `public/_headers`. On your machine they use `pnpm dev`, which has no Content Security
  Policy (CSP). You only need [wrangler](https://developers.cloudflare.com/workers/wrangler/) for
  `pnpm preview` and `pnpm deploy`.
- **Accessibility**: Biome's a11y lint and the axe scans in `e2e/a11y.spec.ts` catch common
  mistakes. They don't mean the app meets WCAG. The
  [accessibility statement](docs/accessibility.md) says what they cover.

## Translating

The app has nine languages, stored as Lingui PO catalogs.

| What | File | Notes |
| --- | --- | --- |
| Interface text | `src/locales/<locale>/messages.po` | ICU messages; the English catalog defines the keys. |
| Statement, heatmap, and role text | `src/core/credit-i18n/locales/<locale>/messages.po` | `output.` keys hold labels and prose; role keys use the canonical NISO URL. |

Edit PO files, then run `pnpm i18n:compile`. It compiles the catalogs and regenerates typed interface keys.
Generated `messages.ts` files are ignored. Missing translations fail compilation.

Role names and descriptions come from [credit-translation](https://github.com/contributorshipcollaboration/credit-translation).
Fix those upstream, then run `node scripts/fetch-credit-translations.mjs` and review the diff.
Attribution stays in `src/core/credit-i18n/translations/CREDITS.md`.

To add a language:

1. Add its BCP 47 code and native name to `AVAILABLE_LOCALES` and `lingui.config.ts`.
2. Copy both English PO catalogs into the new locale directories and translate their entries.
3. Add the core catalog import to `src/core/credit-i18n/catalogs.ts`.
4. Run `pnpm i18n:compile`, then `pnpm exec playwright test e2e/messages.spec.ts`.

The catalog tests check key parity, blank entries, product names, ICU braces, and placeholders.

To report a wrong or missing translation without a PR, use the translation issue form.

## Commit and PR conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/). commitlint checks
  them in a `commit-msg` hook.
- The lefthook hooks format staged files when you commit, and run `pnpm verify` when you push.
- Keep each PR to one change. Say what it changes and how you checked it.
- Sign off every commit, as the next section says.

## Sign off your commits

Every commit in a pull request has a `Signed-off-by:` line, which says you wrote the change
or have the right to submit it under the MIT license: the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). `git commit -s` adds
it, and the lefthook `prepare-commit-msg` hook adds it for you once `pnpm install` has set the hooks up.
`git rebase --signoff upstream/main` (the branch you started from) adds it to commits you already made.
The `dco` workflow fails any pull request with a commit that lacks it; commits by bots are skipped.

## Who maintains this

[GOVERNANCE.md](GOVERNANCE.md) says who decides, who has access, and what happens if the
maintainer stops.

Deploys and rollback are in [docs/deploy.md](docs/deploy.md). What the site tells search engines,
and what to check when you add a page, is in [docs/seo.md](docs/seo.md).
