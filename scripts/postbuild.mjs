// Finishes the static export in out/ for the one thing a static host cannot
// work out per request:
//
// - CSP: gives every exported page a <meta> CSP whose script-src lists the
//   sha256 of that page's own inline <script>s, so injected markup cannot run
//   script. public/_headers sends the rest of the policy with a script-src
//   that still allows inline script; the browser enforces both policies, so a
//   script runs only if both allow it. The hashes live in the page, not the
//   header, because one header line holding every page's hashes outgrows
//   Cloudflare's 2000-character limit. The inline theme bootstrap is fixed at
//   build time, which is what makes hashes possible here; a nonce would need
//   a server.
// - Service worker: stamps the build id into its cache name, so a new version
//   drops the previous build's chunks when it activates, and fills in its page
//   list from src/routes.ts, so each page works offline.
// - Page lists: src/routes.ts and the exported pages name the same paths, and
//   each page has its title, description and canonical link.
//
// Runs after `vite build` (see the `build` script); fails the build rather
// than ship a page whose own scripts the CSP would block, a page without its
// CSP, a _headers file Cloudflare would refuse, or a citation worker that loads
// code from another origin.

// biome-ignore-all lint/correctness/noNodejsModules: Node build script, not client code.
// biome-ignore-all lint/suspicious/noConsole: console is the script's progress output.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "../.vite-ssr/entry-server.mjs";

const OUT = "out";
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
// The page's first element after the charset, so it covers every script.
const HEAD_START = /<head>/;
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

// The worker's CSP allows only 'self', and a third-party runtime could write into the
// service worker's cache, so the worker must load everything from this site.
const workerPath = join(OUT, "citesync-worker.js");
if ((await readFile(workerPath, "utf8")).includes("https://"))
  throw new Error(`postbuild: ${workerPath} names an https:// origin; serve its files from /citesync/`);

const swPath = join(OUT, "sw.js");
const sw = await readFile(swPath, "utf8");
const placeholder = '"credit-matrix-BUILD_ID"';
if (!sw.includes(placeholder)) throw new Error(`postbuild: no ${placeholder} in ${swPath}`);
// 404 and _not-found are error pages, never navigated to by path.
const exported = pages
  .filter((page) => !/^(?:404|_not-found)\.html$/.test(page))
  .map((page) => (page === "index.html" ? "/" : `/${page.replace(/\.html$/, "")}`));
// The router's list (src/routes.ts, through the server build) is the one the prerender, the sitemap and the
// service worker's PAGES are made from; the exported pages must match it.
const sameSet = (a, b) => a.length === b.length && a.every((path) => b.includes(path));
if (!sameSet(paths, exported)) throw new Error(`postbuild: src/routes.ts has ${paths}, out/ exports ${exported}`);
// Each prerendered page has its own head tags and the preloads for its chunks (scripts/prerender.mjs
// puts those in a loader that runs after the first paint).
for (const path of exported) {
  const html = await readFile(join(OUT, path === "/" ? "index.html" : `${path.slice(1)}.html`), "utf8");
  const title = html.match(/<title>(.*?)<\/title>/)?.[1];
  const problems = [
    !title && "title",
    !/<meta name="description" content="[^"]+">/.test(html) && "meta description",
    !html.includes(`<link rel="canonical" href="https://credit.duinlab.nl${path}">`) && "canonical link",
    !html.includes('["link","\\u002fassets\\u002f') && "modulepreload (in the deferred script loader)",
    // The browser build emits a docs image only because the page imports src/docs/images.ts.
    ...[...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)]
      .filter(([, file]) => !existsSync(join(OUT, file)))
      .map(([, file]) => `${file} (not in out/)`),
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`postbuild: ${path} lacks ${problems.join(", ")}`);
}
// The page references every hashed chunk, and the converter files name its
// runtime, so the digest changes exactly when the build does.
const buildInputs = ["index.html", "citesync-worker.js", "citesync/runtime.json", "citesync/pyodide/pyodide-lock.json"];
const buildId = sha256(Buffer.concat(await Promise.all(buildInputs.map((file) => readFile(join(OUT, file))))))
  .replace(/[^A-Za-z0-9]/g, "")
  .slice(0, 12);
// Of the figure fonts (about 40 MB), only Noto Sans (0.57 MB, the default face) is precached, with the
// subsetter every export needs (0.68 MB), so a default figure exports offline from the first visit; the
// worker caches the others when an export fetches them.
// The docs are not precached either: the worker caches a docs page and its chunk on a visit.
const manifest = JSON.parse(await readFile(join(OUT, ".vite", "manifest.json"), "utf8"));
const docsChunks = new Set(
  Object.entries(manifest)
    .filter(([source]) => source.startsWith("src/app/docs/") || source === "src/docs/LiveExample.tsx")
    .map(([, { file }]) => file.replace(/^assets\//, "")),
);
if (docsChunks.size === 0) throw new Error("postbuild: no docs chunk in the Vite manifest");
const precachedPages = paths.filter((path) => !/^\/docs(?:\/|$)/.test(path));
const assets = (await readdir(join(OUT, "assets"), { recursive: true }))
  .filter((file) => /\.(?:js|css)$|^NotoSans-Regular-[\w-]+\.ttf$|^harfbuzz-subset-[\w-]+\.wasm$/.test(file))
  .filter((file) => !docsChunks.has(file))
  .map((file) => `/assets/${file}`)
  .sort();
if (
  !assets.some((file) => file.includes("/NotoSans-Regular-")) ||
  !assets.some((file) => file.includes("/harfbuzz-subset-"))
)
  throw new Error("postbuild: the default figure font or the subsetter is not in the service worker precache");
if (!sw.includes("const ASSETS = [];")) throw new Error("postbuild: missing service worker asset placeholder");
if (!sw.includes("const PAGES = [];")) throw new Error("postbuild: missing service worker page placeholder");
if (!sw.includes("const PRECACHED_PAGES = [];"))
  throw new Error("postbuild: missing service worker precached page placeholder");
await writeFile(
  swPath,
  sw
    .replace(placeholder, `"credit-matrix-${buildId}"`)
    .replace("const ASSETS = [];", `const ASSETS = ${JSON.stringify(assets)};`)
    .replace("const PAGES = [];", `const PAGES = ${JSON.stringify(paths)};`)
    .replace("const PRECACHED_PAGES = [];", `const PRECACHED_PAGES = ${JSON.stringify(precachedPages)};`),
);

console.log(`postbuild: CSP script hashes per page: ${counts.join(", ")}; service worker cache ${buildId}`);
