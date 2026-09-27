// biome-ignore lint/correctness/noNodejsModules: the Next config runs in Node, not the browser.
import process from "node:process";
import type { NextConfig } from "next";

/**
 * A CSP directive does not inherit from `default-src` when it is absent. It is
 * simply unrestricted. The previous value set only `base-uri`, `frame-ancestors`
 * and `object-src`, so it read as XSS protection while allowing scripts,
 * connections and form posts to any origin. `default-src 'self'` closes that.
 *
 * - `script-src` keeps 'unsafe-inline' for Next's inline bootstrap. Be clear
 *   about what that costs: with it, script-src is NOT an XSS mitigation — an
 *   attacker who can inject markup can run script. The real controls against
 *   that are React's escaping plus connect-src/form-action/object-src limiting
 *   where anything could exfiltrate to. Dropping 'unsafe-inline' needs a
 *   per-request nonce threaded through the document.
 * - `img-src` needs blob:/data: for the heatmap PNG (canvas → createObjectURL).
 * - `connect-src 'self'` is enough: the ORCID call goes through /api/orcid.
 *
 * `'unsafe-eval'` is added in development only: the dev server evaluates HMR
 * updates as strings, and without it the client bundle dies on load. The
 * shipped build never evaluates strings, so production stays strict.
 */
const isDev = process.env.NODE_ENV === "development";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers() {
    return Promise.resolve([
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ]);
  },
  // Single self-contained Next.js app: domain logic runs in the browser via
  // @credit-generator/core, and the only server endpoint (ORCID proxy) is a
  // route handler under src/app/api. Deploy bundling is handled by
  // @opennextjs/cloudflare, so no Next `output` mode is needed.
  // core ships its TS source (just-in-time internal package); Next transpiles it.
  transpilePackages: ["@credit-generator/core"],
  // Cloudflare Workers Builds sets this for the deploy that runs the build;
  // baked in here so /health can report which commit is actually live. `env`
  // inlines the value at build time, since the Worker has no process.env at
  // request time the way a container would.
  env: {
    WORKERS_CI_COMMIT_SHA: process.env.WORKERS_CI_COMMIT_SHA ?? "dev",
  },
};

export default nextConfig;
