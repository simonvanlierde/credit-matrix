# Deploying

## How it works

The site is a static export (`out/`) served by a Cloudflare Worker with static assets only.

On every push to `main`, `.github/workflows/ci.yml` runs `check`, `e2e` and `build`. When all three pass, the `deploy` job:

1. Downloads the `out/` folder the `build` job made, so the deployed files are the ones that were built and tested.
2. Attests build provenance for a tarball of `out/` (see the Attestations tab on GitHub).
3. Runs `wrangler deploy`.

If the `CLOUDFLARE_API_TOKEN` secret is missing, the deploy step prints a notice and the job still passes.

On pull requests, the `preview` job uploads the build as a Worker version with `wrangler versions upload` and writes the preview URL to the job summary. It skips on fork PRs and when the secret is missing. The URL only appears if Preview URLs are on for the Worker (dashboard: Settings, Domains and Routes).

## Roll back

- Fastest: `pnpm exec wrangler rollback` (pick a version, or pass a version id).
- Dashboard: Workers & Pages, `credit-heatmap`, Deployments tab, then "Rollback" on an earlier deployment.
- Permanent: `git revert <sha>` and push to `main`. The pipeline redeploys the reverted code.

A rollback by CLI or dashboard lasts only until the next push to `main` deploys again.

> [!WARNING]
> Do not roll back across a release that raised the storage version (`PERSIST_VERSION` in `src/store/persist-meta.ts`). Browsers that ran the newer build hold drafts saved in its format, and an older build refuses to write over them: those users would see their edits go unsaved. After such a release, roll forward with a fix instead.

## One-time setup

1. Create an API token at dash.cloudflare.com, My Profile, API Tokens. Use the "Edit Cloudflare Workers" template, limited to this account.
2. In the GitHub repo, Settings, Secrets and variables, Actions, add:
   - `CLOUDFLARE_API_TOKEN`: the token.
   - `CLOUDFLARE_ACCOUNT_ID`: the account id (dashboard sidebar or `wrangler whoami`).
3. Push to `main` and check that the `Deploy` job ran `wrangler deploy` and the site updated.
4. After that first Actions deploy works, turn off Cloudflare Workers Builds: Workers & Pages, `credit-heatmap`, Settings, Builds, disconnect the Git repository. Leaving it on deploys every commit twice.
