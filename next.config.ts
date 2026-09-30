// biome-ignore lint/correctness/noNodejsModules: the Next config runs in Node, not the browser.
import process from "node:process";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A static export, served as Cloudflare Workers static assets with no Worker
  // code: the app runs entirely in the browser, and the ORCID and Crossref
  // lookups go straight to those APIs (both send permissive CORS headers).
  // Response headers, including the CSP, live in public/_headers.
  output: "export",
  poweredByHeader: false,
  // core ships its TS source (just-in-time internal package); Next transpiles it.
  transpilePackages: ["@credit-generator/core"],
  // Cloudflare Workers Builds sets this for the deploy that runs the build;
  // baked in here so /health.json can report which commit is actually live.
  env: {
    WORKERS_CI_COMMIT_SHA: process.env.WORKERS_CI_COMMIT_SHA ?? "dev",
  },
};

export default nextConfig;
