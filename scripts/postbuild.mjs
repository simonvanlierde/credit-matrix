// Finishes the static export in out/ for the one thing a static host cannot
// work out per request:
//
// - CSP: gives every exported page a <meta> CSP whose script-src lists the
//   sha256 of that page's own inline <script>s, so injected markup cannot run
//   script. public/_headers sends the rest of the policy with a script-src
//   that still allows inline script; the browser enforces both policies, so a
//   script runs only if both allow it. The hashes live in the page, not the
//   header, because one header line holding every page's hashes outgrows
//   Cloudflare's 2000-character limit. Next's inline bootstrap is fixed at
//   build time, which is what makes hashes possible here; a nonce would need
//   a server.
// - Service worker: stamps the build id into its cache name, so a new version
//   drops the previous build's chunks when it activates, and checks that its
//   page list names every exported page, so each one works offline.
//
// Runs after `next build` (see the `build` script); fails the build rather
// than ship a page whose own scripts the CSP would block, a page without its
// CSP, or a _headers file Cloudflare would refuse.

// biome-ignore-all lint/correctness/noNodejsModules: Node build script, not client code.
// biome-ignore-all lint/suspicious/noConsole: console is the script's progress output.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = "out";
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
// The page's first element after the charset, so it covers every script.
const HEAD_START = /<head>(<meta charSet="utf-8"\/>)?/;
// Cloudflare refuses a _headers file with a longer line (error 100324).
const MAX_HEADER_LINE = 2000;
const sha256 = (text) => createHash("sha256").update(text).digest("base64");

const headersPath = join(OUT, "_headers");
const headers = await readFile(headersPath, "utf8");
// The meta CSP allows the same outside script origins as the header, read from it so the two cannot drift.
const scriptOrigins = headers.match(/script-src 'self' 'unsafe-inline'([^;\n]*)/)?.[1];
if (scriptOrigins === undefined) throw new Error(`postbuild: no script-src 'self' 'unsafe-inline' in ${headersPath}`);

const pages = (await readdir(OUT, { recursive: true })).filter((file) => file.endsWith(".html"));
const counts = [];
for (const page of pages) {
  const path = join(OUT, page);
  const html = await readFile(path, "utf8");
  const hashes = new Set([...html.matchAll(INLINE_SCRIPT)].map(([, body]) => `'sha256-${sha256(body)}'`));
  const meta = `<meta http-equiv="Content-Security-Policy" content="script-src 'self' ${[...hashes].sort().join(" ")}${scriptOrigins}"/>`;
  const withMeta = html.replace(HEAD_START, (start) => start + meta);
  if (!withMeta.includes(meta)) throw new Error(`postbuild: no <head> to put the CSP in, in ${path}`);
  await writeFile(path, withMeta);
  counts.push(`${page} ${hashes.size}`);
}

const tooLong = headers.split("\n").findIndex((line) => line.length > MAX_HEADER_LINE);
if (tooLong !== -1)
  throw new Error(`postbuild: ${headersPath} line ${tooLong + 1} is over ${MAX_HEADER_LINE} characters`);

const swPath = join(OUT, "sw.js");
const sw = await readFile(swPath, "utf8");
const placeholder = '"credit-matrix-BUILD_ID"';
if (!sw.includes(placeholder)) throw new Error(`postbuild: no ${placeholder} in ${swPath}`);
const swPages = JSON.parse(sw.match(/const PAGES = (\[[^\]]*\]);/)?.[1] ?? "null");
if (!swPages) throw new Error(`postbuild: no PAGES list in ${swPath}`);
// 404 and _not-found are error pages, never navigated to by path.
const exported = pages
  .filter((page) => !/^(?:404|_not-found)\.html$/.test(page))
  .map((page) => (page === "index.html" ? "/" : `/${page.replace(/\.html$/, "")}`));
const missing = exported.filter((path) => !swPages.includes(path));
if (missing.length > 0) throw new Error(`postbuild: ${swPath} PAGES lacks ${missing.join(", ")}`);
// The page references every hashed chunk, so its digest changes exactly when
// the build does.
const buildId = sha256(await readFile(join(OUT, "index.html")))
  .replace(/[^A-Za-z0-9]/g, "")
  .slice(0, 12);
await writeFile(swPath, sw.replace(placeholder, `"credit-matrix-${buildId}"`));

console.log(`postbuild: CSP script hashes per page: ${counts.join(", ")}; service worker cache ${buildId}`);
