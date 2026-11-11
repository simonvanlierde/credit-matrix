# Deploying

## Self-hosting

`pnpm build` builds the `credit-matrix` package, compiles the Lingui catalogs, and runs the Vite
client and prerender builds. Then [`scripts/postbuild.mjs`](../scripts/postbuild.mjs) gives each
exported page a `<meta>` CSP listing the hashes of that page's inline scripts, and names the service
worker's cache after the build. The result is a static export in `out/` that any static host can
serve. The response
headers, including the rest of the CSP, are in [`public/_headers`](../public/_headers).

To host it on Cloudflare yourself, set your own domain in [`wrangler.jsonc`](../wrangler.jsonc):

```bash
pnpm preview        # build + serve out/ locally, headers applied
pnpm deploy         # build + deploy to your Cloudflare account
```

## How the live site deploys

The live site serves `out/` as Cloudflare Workers static assets, with no Worker code.

On every push to `main`, `.github/workflows/ci.yml` runs `check`, `e2e` and `build`. The `attest` job
then attests build provenance for each file in `out/` (see the Attestations tab on GitHub). It is
the only job in this workflow that can request a GitHub OIDC token, and it installs nothing and runs
no project code.

When all four pass, the `deploy` job downloads the `out/` folder the `build` job made, so the
deployed files are the ones that were built and tested, and runs `wrangler deploy`. It runs in the
`production` environment, which only `main` can use, and reads its Cloudflare secrets from there.
The repository itself holds no Cloudflare secrets. If `CLOUDFLARE_API_TOKEN` is
missing, the deploy step prints a notice and the job still passes.

On pull requests, the `preview` job deploys the build as its own Worker, `credit-matrix-pr-<number>`
(from `wrangler.preview.jsonc`), and writes its `workers.dev` address to the job summary. That is the
only address: the config sets `preview_urls: false`. A preview is live only while its PR is open and
not a draft: a draft gets none, and the job re-reads the PR just before it deploys. The job runs in the
`preview` environment with its own secrets. It skips fork PRs, bot PRs such as Renovate's, and any
run where the token is missing.
Previews are public and send `X-Robots-Tag: noindex`.

`preview-retire.yml` runs when a PR closes, merges or turns draft. It deletes the PR's Worker
through the Cloudflare API, then fetches the address and fails unless it answers 404, which shows the
Worker is gone. A daily run lists the account's `credit-matrix-pr-<number>` Workers and deletes each
whose PR is not open and ready, plus the old shared `credit-matrix-preview` Worker. When it cannot
read a PR, it keeps that Worker and fails. The shell is in `.github/scripts/preview-retire.sh`, a
copy of the project-templates script, which is tested there.

To retire previews by hand, run `preview-retire.yml` from the Actions tab. Give it PR numbers to
retire those previews now, or leave the list empty to run the sweep.

The preview token needs one permission, Account > Workers Scripts: Edit, and the account needs a
`workers.dev` subdomain. Production also sets `preview_urls: false`, so its versions get no preview
URL.

## Roll back

- Fastest: `pnpm exec wrangler rollback` (pick a version, or pass a version id).
- Dashboard: Workers & Pages, `credit-matrix`, Deployments tab, then "Rollback" on an earlier deployment.
- Permanent: `git revert <sha>` and push to `main`. The pipeline redeploys the reverted code.

A rollback by CLI or dashboard lasts only until the next push to `main` deploys again.

> [!WARNING]
> Do not roll back across a release that raised the storage version (`PERSIST_VERSION` in `src/store/persist-meta.ts`). Browsers that ran the newer build hold drafts saved in its format, and an older build refuses to write over them: those users would see their edits go unsaved. After such a release, roll forward with a fix instead.

## The npm package

Pushing a `v*` tag publishes `src/core` as the [`credit-matrix`](../src/core/README.md) npm package,
through `.github/workflows/release-core.yml`. It runs in three jobs:

1. `build`, with read-only rights: checks that the tagged commit is on `main` and that the tag
   matches the version in `src/core/package.json` (`pnpm version` keeps it in step with the
   app's), runs the core tests against the build, packs the tarball with `npm pack` and uploads it.
2. `publish`, in the `npm-release` environment, which only `v*` tags can use (a tag ruleset lets
   only the owner create them): downloads that tarball, checks npm is 11.5.1 or
   later, and runs `npm publish <tarball> --provenance --access public`. It installs nothing and
   runs no project code, so the token it holds never meets a dependency's install script.
3. `release`, after npm publishing succeeds: attests the same tarball with `actions/attest`,
   verifies its provenance and SBOM, and creates a draft GitHub release. It attaches the tarball,
   `<tarball>.intoto.jsonl`, `<tarball>.cdx.json` and the SBOM's attestation bundle. It runs no
   project code. The owner reviews the notes and publishes the draft after all assets are present.

With immutable releases enabled, publishing locks the tag and assets. If draft preparation fails
after npm publishing succeeds, rerun only the failed job; rerunning the successful npm job would
try to publish an existing version. Rerun the `release` job within 7 days, while the tarball
artifact is still retained, and delete any half-made draft release first.

To verify a downloaded release tarball, run
`gh attestation verify credit-matrix-<version>.tgz --repo simonvanlierde/credit-matrix`.
Add `--predicate-type https://cyclonedx.org/bom` to verify its SBOM attestation.

The package uses npm trusted publishing: npm accepts the workflow's GitHub OIDC token instead of an access
token, so no `NPM_TOKEN` secret exists, and the package page links each version to the workflow run
that built it. On npmjs.com, the trusted publisher may publish but not move dist-tags, and the
package refuses access tokens, so a version comes from this workflow or from the owner's own
two-factor login.

Check what would be published with `cd src/core && npm pack --dry-run`. On every pull request
outside `census/`, the CI `check` job builds the package and tests the files it publishes, its
export list, public types and CLI (`src/core/__tests__/package.test.ts`).

The package build is repeatable: two builds from the same commit give byte-identical tarballs.
Check with `cd src/core && npm pack --pack-destination /tmp/a && npm pack --pack-destination /tmp/b && cmp /tmp/a/*.tgz /tmp/b/*.tgz`.

### The fonts package

`src/fonts` is the [`credit-matrix-fonts`](../src/fonts/README.md) package. It has its own version
and changes only when the fonts do. `FIGURE_FONTS_VERSION` and `FIGURE_FONT_FILES` in
`src/core/figure-fonts.ts` pin the release the download fetches and the hashes it checks;
`src/core/__tests__/figure-fonts.test.ts` fails when they drift from `src/fonts`.

Every `v*` release packs `src/fonts` too. The `publish` job uploads it before `credit-matrix`, but
only when npm does not have that version yet. To release new fonts, bump
`src/fonts/package.json`, update the pin and hashes, and tag a release as usual. A core that needs a
face added in fonts 1.N raises its peer range floor to `^1.N.0` in the same release.

Fonts releases go through trusted publishing like `credit-matrix`. The package's trusted publisher
is `release-core.yml` with the `npm-release` environment, and
https://www.npmjs.com/package/credit-matrix-fonts/access is set to "Require two-factor
authentication and disallow tokens". A tag whose fonts version npm lacks publishes it before core.
A tag whose fonts version npm has, with other bytes, fails with "differs from src/fonts. Bump its
version". A hand publish must come from a clean checkout of `origin/main`, or it hits that check.

### Roll back a version

A published name and version can never be used again, even after an unpublish. So roll forward:

1. Fix the problem and release a patch version.
2. Point people away from the bad one:
   `npm deprecate credit-matrix@<version> "<what is wrong>, use <fixed version>"`. Installs of that
   version still work, but print the message.

Unpublish (`npm unpublish credit-matrix@<version>`) only within 72 hours of publishing, and only
when no other package depends on it. Even then, prefer deprecating.
