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
when a `v*` tag is pushed. It checks that the tag matches the version in `src/core/package.json`
(`pnpm version` keeps it in step with the app's), runs the core tests against the build, and runs
`npm publish --provenance --access public`.

It uses npm trusted publishing: npm accepts the workflow's GitHub OIDC token instead of an access
token, so no `NPM_TOKEN` secret exists. The package page then links each version to the workflow
run that built it.

Check what would be published with `cd src/core && npm pack --dry-run`. The CI `package` job runs
the same on every pull request.

### One-time setup

1. Create the package on npmjs.com. Trusted publishing can only be added to a package that exists,
   so publish the first version by hand from a clean checkout of the release tag, logged in as the
   owner with two-factor authentication:

   ```bash
   pnpm install --frozen-lockfile
   cd src/core && npm publish --access public --provenance=false
   ```

   `--provenance=false` because provenance needs the CI token; this one version goes without. The
   workflow run for that tag fails, as it has no publisher yet or finds the version taken.
2. On npmjs.com, open the package, then Settings, Trusted publishing, and add a GitHub Actions
   publisher: organization or user `simonvanlierde`, repository `credit-matrix`, workflow filename
   `release-core.yml`, no environment.
3. Under Settings, Publishing access, choose "Require two-factor authentication and disallow
   tokens", so only the trusted workflow can publish.
4. Push the next release tag and check that the `Publish to npm` job passed and that the version on
   npmjs.com shows a provenance badge.
