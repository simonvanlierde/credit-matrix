import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Reports the commit currently deployed (baked in at build time via
 * `next.config.ts`'s `env`, from Cloudflare Workers Builds'
 * `WORKERS_CI_COMMIT_SHA`) and whether the rate limiter this Worker depends on
 * is actually bound, so a smoke test can tell "deployed" from "deployed and
 * configured" rather than trusting a static 200.
 */
export function GET() {
  let bound = true;
  try {
    const env = getCloudflareContext().env as Record<string, unknown>;
    bound = "API_RATE_LIMITER" in env;
  } catch {
    // No Workers context at all: `next dev` or a local `next start`. Nothing
    // to check off Workers, so report healthy rather than faulting a binding
    // that only exists in production.
  }

  return Response.json(
    // biome-ignore lint/correctness/noProcessGlobal: next.config.ts `env` inlines this at build time; the Worker has no process.env.
    { status: bound ? "ok" : "unavailable", commit: process.env.WORKERS_CI_COMMIT_SHA ?? "dev" },
    { status: bound ? 200 : 503 },
  );
}
