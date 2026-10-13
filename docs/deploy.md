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
