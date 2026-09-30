// Finishes the static export in out/ for the one thing a static host cannot
// work out per request:
//
// - CSP: replaces 'unsafe-inline' in script-src with the sha256 of every
//   inline <script> the export emitted, so injected markup cannot run script.
//   Next's inline bootstrap is fixed at build time, which is what makes
//   hashes possible here; a nonce would need a server.
// - Service worker: stamps the build id into its cache name, so a new version
//   drops the previous build's chunks when it activates.
//
// Runs after `next build` (see the `build` script); fails the build rather
// than ship a page whose own scripts the CSP would block.

// biome-ignore-all lint/correctness/noNodejsModules: Node build script, not client code.
// biome-ignore-all lint/suspicious/noConsole: console is the script's progress output.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = "out";
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const sha256 = (text) => createHash("sha256").update(text).digest("base64");

const pages = (await readdir(OUT, { recursive: true })).filter((file) => file.endsWith(".html"));
const hashes = new Set();
for (const page of pages) {
  for (const [, body] of (await readFile(join(OUT, page), "utf8")).matchAll(INLINE_SCRIPT)) {
    hashes.add(`'sha256-${sha256(body)}'`);
  }
}

const headersPath = join(OUT, "_headers");
const headers = await readFile(headersPath, "utf8");
const inlineSource = "script-src 'self' 'unsafe-inline'";
if (!headers.includes(inlineSource)) throw new Error(`postbuild: "${inlineSource}" not found in ${headersPath}`);
// Only script-src's: style-src keeps 'unsafe-inline' for React style attributes.
await writeFile(headersPath, headers.replace(inlineSource, `script-src 'self' ${[...hashes].sort().join(" ")}`));

const swPath = join(OUT, "sw.js");
const sw = await readFile(swPath, "utf8");
const placeholder = '"credit-matrix-BUILD_ID"';
if (!sw.includes(placeholder)) throw new Error(`postbuild: no ${placeholder} in ${swPath}`);
// The page references every hashed chunk, so its digest changes exactly when
// the build does.
const buildId = sha256(await readFile(join(OUT, "index.html")))
  .replace(/[^A-Za-z0-9]/g, "")
  .slice(0, 12);
await writeFile(swPath, sw.replace(placeholder, `"credit-matrix-${buildId}"`));

console.log(`postbuild: ${hashes.size} script hashes in the CSP, service worker cache ${buildId}`);
