# Deploying

## How it works

The site is a static export (`out/`) served by a Cloudflare Worker with static assets only.

On every push to `main`, `.github/workflows/ci.yml` runs `check`, `e2e` and `build`. After `build`, the `attest` job downloads the `out/` folder and attests build provenance for each file in it (see the Attestations tab on GitHub). It is the only job that can request a GitHub OIDC token. It installs nothing and runs no project code.

When `check`, `e2e`, `build` and `attest` all pass, the `deploy` job:

1. Downloads the `out/` folder the `build` job made, so the deployed files are the ones that were built and tested.
2. Runs `wrangler deploy`.

The `deploy` job runs in the `production` environment and reads its Cloudflare secrets from there. If `CLOUDFLARE_API_TOKEN` is missing, the deploy step prints a notice and the job still passes.

On pull requests, the `preview` job uploads the build as a Worker version with `wrangler versions upload` and writes the preview URL to the job summary. It runs in the `preview` environment and reads its own secrets from there. It skips on fork PRs and when the token is missing. The URL only appears if Preview URLs are on for the Worker (dashboard: Settings, Domains and Routes).

## Roll back

- Fastest: `pnpm exec wrangler rollback` (pick a version, or pass a version id).
- Dashboard: Workers & Pages, `credit-heatmap`, Deployments tab, then "Rollback" on an earlier deployment.
- Permanent: `git revert <sha>` and push to `main`. The pipeline redeploys the reverted code.

A rollback by CLI or dashboard lasts only until the next push to `main` deploys again.

> [!WARNING]
> Do not roll back across a release that raised the storage version (`PERSIST_VERSION` in `src/store/persist-meta.ts`). Browsers that ran the newer build hold drafts saved in its format, and an older build refuses to write over them: those users would see their edits go unsaved. After such a release, roll forward with a fix instead.

## One-time setup

1. Create two API tokens at dash.cloudflare.com, My Profile, API Tokens, both limited to this account:
   - Production: the "Edit Cloudflare Workers" template.
   - Preview: a separate token with only the rights `wrangler versions upload` needs (Account, Workers Scripts, Edit). Give it a short expiry and rotate it.
2. In the GitHub repo, Settings, Environments, create two environments:
   - `production`: under "Deployment branches and tags", choose "Selected branches and tags" and add `main` only. Add the secrets `CLOUDFLARE_API_TOKEN` (the production token) and `CLOUDFLARE_ACCOUNT_ID` (dashboard sidebar or `wrangler whoami`).
   - `preview`: add `CLOUDFLARE_API_TOKEN` (the preview token) and `CLOUDFLARE_ACCOUNT_ID`.
3. Delete the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets, if any (Settings, Secrets and variables, Actions). Only the environments should hold them.
4. Push to `main` and check that the `Deploy` job ran `wrangler deploy` and the site updated.
5. After that first Actions deploy works, turn off Cloudflare Workers Builds: Workers & Pages, `credit-heatmap`, Settings, Builds, disconnect the Git repository. Leaving it on deploys every commit twice.

## The npm package

`.github/workflows/release-core.yml` publishes `src/core` as the [`credit-matrix`](../src/core/README.md) npm package
when a `v*` tag is pushed. It runs in two jobs:

1. `build`, with read-only rights: checks that the tagged commit is on `main` and that the tag
   matches the version in `src/core/package.json` (`pnpm version` keeps it in step with the
   app's), runs the core tests against the build, packs the tarball with `npm pack` and uploads it.
2. `publish`, in the `npm-release` environment: downloads that tarball, checks npm is 11.5.1 or
   later, and runs `npm publish <tarball> --provenance --access public`. It installs nothing and
   runs no project code, so the token it holds never meets a dependency's install script.

It uses npm trusted publishing: npm accepts the workflow's GitHub OIDC token instead of an access
token, so no `NPM_TOKEN` secret exists. The package page then links each version to the workflow
run that built it.

Check what would be published with `cd src/core && npm pack --dry-run`. The CI `package` job runs
the same on every pull request.

### One-time setup

The `v0.7.0` tag predates the package, so the first version on npm is the release after 0.7.0.

1. In the GitHub repo, Settings, Environments, create `npm-release`. Under "Deployment branches
   and tags", choose "Selected branches and tags" and add the tag rule `v*` only. It needs no
   secrets.
2. Settings, Rules, Rulesets: add a tag ruleset targeting `v*` that restricts creations (and
   updates and deletions), with only yourself on the bypass list, so nobody else can push a
   release tag.
3. Create the package on npmjs.com. Trusted publishing can only be added to a package that exists,
   so publish the first version by hand. Bump the version (`pnpm version minor` or `patch`), merge
   it to `main` and push the tag. The workflow run for that tag fails, as npm has no publisher for
   the package yet. Then, from a clean checkout of that tag, logged in as the owner with
   two-factor authentication:

   ```bash
   git switch --detach vX.Y.Z
   pnpm install --frozen-lockfile
   pnpm exec vitest run --project core
   cd src/core && npm publish --access public --provenance=false
   ```

   `--provenance=false` because provenance needs the CI token; this one version goes without.
4. On npmjs.com, open the package, then Settings, Trusted publishing, and add a GitHub Actions
   publisher: organization or user `simonvanlierde`, repository `credit-matrix`, workflow filename
   `release-core.yml`, environment `npm-release`.
5. Under Settings, Publishing access, choose "Require two-factor authentication and disallow
   tokens", so only the trusted workflow can publish.
6. Push the next release tag and check that the `Publish to npm` job passed and that the version on
   npmjs.com shows a provenance badge.

### Roll back a version

A published name and version can never be used again, even after an unpublish. So roll forward:

1. Fix the problem and release a patch version.
2. Point people away from the bad one:
   `npm deprecate credit-matrix@<version> "<what is wrong>, use <fixed version>"`. Installs of that
   version still work, but print the message.

Unpublish (`npm unpublish credit-matrix@<version>`) only within 72 hours of publishing, and only
when no other package depends on it. Even then, prefer deprecating.
