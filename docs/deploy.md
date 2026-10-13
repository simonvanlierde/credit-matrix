# Deploying

## Self-hosting

`pnpm build` builds the `credit-matrix` package, runs `next build`, then
[`scripts/postbuild.mjs`](../scripts/postbuild.mjs), which replaces `'unsafe-inline'` in the CSP
with the hashes of the exported inline scripts and names the service worker's cache after the
build. The result is a static export in `out/` that any static host can serve. The response
headers, including the CSP, are in [`public/_headers`](../public/_headers).

To host it on Cloudflare yourself, set your own domain in [`wrangler.jsonc`](../wrangler.jsonc):

```bash
pnpm preview        # build + serve out/ locally, headers applied
pnpm deploy         # build + deploy to your Cloudflare account
```

## How the live site deploys

The live site serves `out/` as Cloudflare Workers static assets, with no Worker code.

On every push to `main`, `.github/workflows/ci.yml` runs `check`, `e2e` and `build`. The `attest` job
then attests build provenance for each file in `out/` (see the Attestations tab on GitHub). It is
the only job that can request a GitHub OIDC token, and it installs nothing and runs no project code.

When all four pass, the `deploy` job downloads the `out/` folder the `build` job made, so the
deployed files are the ones that were built and tested, and runs `wrangler deploy`. It runs in the
`production` environment, which only `main` can use, and reads its Cloudflare secrets from there.
The repository itself holds no Cloudflare secrets. If `CLOUDFLARE_API_TOKEN` is
missing, the deploy step prints a notice and the job still passes.

On pull requests, the `preview` job uploads the build as a Worker version with
`wrangler versions upload` and writes the preview URL to the job summary. It runs in the `preview`
environment with its own secrets, and skips on fork PRs and when the token is missing. The URL only
appears if Preview URLs are on for the Worker (dashboard: Settings, Domains and Routes).

## Roll back

- Fastest: `pnpm exec wrangler rollback` (pick a version, or pass a version id).
- Dashboard: Workers & Pages, `credit-matrix`, Deployments tab, then "Rollback" on an earlier deployment.
- Permanent: `git revert <sha>` and push to `main`. The pipeline redeploys the reverted code.

A rollback by CLI or dashboard lasts only until the next push to `main` deploys again.

> [!WARNING]
> Do not roll back across a release that raised the storage version (`PERSIST_VERSION` in `src/store/persist-meta.ts`). Browsers that ran the newer build hold drafts saved in its format, and an older build refuses to write over them: those users would see their edits go unsaved. After such a release, roll forward with a fix instead.

## The npm package

Pushing a `v*` tag publishes `src/core` as the [`credit-matrix`](../src/core/README.md) npm package,
through `.github/workflows/release-core.yml`. It runs in two jobs:

1. `build`, with read-only rights: checks that the tagged commit is on `main` and that the tag
   matches the version in `src/core/package.json` (`pnpm version` keeps it in step with the
   app's), runs the core tests against the build, packs the tarball with `npm pack` and uploads it.
2. `publish`, in the `npm-release` environment, which only `v*` tags can use (a tag ruleset lets
   only the owner create them): downloads that tarball, checks npm is 11.5.1 or
   later, and runs `npm publish <tarball> --provenance --access public`. It installs nothing and
   runs no project code, so the token it holds never meets a dependency's install script.

It uses npm trusted publishing: npm accepts the workflow's GitHub OIDC token instead of an access
token, so no `NPM_TOKEN` secret exists, and the package page links each version to the workflow run
that built it. On npmjs.com, the trusted publisher may publish but not move dist-tags, and the
package refuses access tokens, so a version comes from this workflow or from the owner's own
two-factor login.

Check what would be published with `cd src/core && npm pack --dry-run`. On every pull request, the
CI `check` job builds the package and tests the files it publishes, its export list, public types
and CLI (`src/core/__tests__/package.test.ts`).

### Roll back a version

A published name and version can never be used again, even after an unpublish. So roll forward:

1. Fix the problem and release a patch version.
2. Point people away from the bad one:
   `npm deprecate credit-matrix@<version> "<what is wrong>, use <fixed version>"`. Installs of that
   version still work, but print the message.

Unpublish (`npm unpublish credit-matrix@<version>`) only within 72 hours of publishing, and only
when no other package depends on it. Even then, prefer deprecating.
