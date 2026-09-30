/**
 * Reports the commit this build came from, so the smoke test can tell when a
 * deploy is live. Rendered to a static file at build time; `next.config.ts`'s
 * `env` inlines Cloudflare Workers Builds' `WORKERS_CI_COMMIT_SHA`.
 */
export const dynamic = "force-static";

export function GET() {
  // biome-ignore lint/correctness/noProcessGlobal: next.config.ts `env` inlines this at build time.
  return Response.json({ commit: process.env.WORKERS_CI_COMMIT_SHA ?? "dev" });
}
