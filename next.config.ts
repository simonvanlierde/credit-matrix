import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A static export, served as Cloudflare Workers static assets with no Worker
  // code: the app runs entirely in the browser, and the ORCID and Crossref
  // lookups go straight to those APIs (both send permissive CORS headers).
  // Response headers, including the CSP, live in public/_headers.
  output: "export",
  poweredByHeader: false,
};

export default nextConfig;
