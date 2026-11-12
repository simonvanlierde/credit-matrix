// biome-ignore-all lint/correctness/noNodejsModules: Node build check.
// biome-ignore-all lint/suspicious/noConsole: build diagnostics.
// Fails when the app or its separately loaded figure exporter outgrows its budget, when the service worker's
// install precache grows (a figure font in it costs every first visit megabytes), or when the npm package
// does (every `npm i credit-matrix` downloads it; the fonts live in credit-matrix-fonts). Script sizes are the sum of
// each file compressed alone, as a static host serves them; the precache is raw bytes. Run after `pnpm build`.
// Raise a limit on purpose, in the same commit as the change that needs it.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

// Measured 2026-11-12: 438 kB gzip with writing-tool panels and nine interface catalogs.
const LIMIT_GZIP = 440_000;
// Measured 2026-11-12: 1.6 kB for the /docs page: the nav metadata, no Markdown (pages are prerendered).
const DOCS_LIMIT_GZIP = 2_500;
// Measured 2026-11-12: 425 kB raw for Component UI and the full English index.
// Loaded on the first docs visit, separately from the install precache.
const SEARCH_LIMIT = 470_000;
// Embedded-font PDF generation is loaded on export; keep its cost separate from editing.
const FIGURE_LIMIT_GZIP = 555_000;
// Measured 2026-11-11: 2.55 MB of scripts and styles plus Noto Sans (0.57 MB), the one figure font
// precached, and the subsetter every export needs (0.68 MB). Any other figure font is 0.62-14.9 MB.
// Measured 2026-11-12: 4.30 MB including pages, their linked UI fonts and the offline manifest.
// Docs pages and search are cached separately on a docs visit.
const PRECACHE_LIMIT = 4_400_000;
// Measured 2026-11-11: 2.3 MB unpacked once the fonts moved out (0.12.0 was 43 MB).
const PACKAGE_LIMIT = 5_000_000;

const dir = join(import.meta.dirname, "..", "out", "assets");
const files = existsSync(dir)
  ? readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".js"))
      .map((f) => ({ name: f, bytes: readFileSync(join(dir, f)) }))
  : [];
if (files.length === 0) {
  console.error(`check-bundle-size: no .js files in ${dir}. Run 'pnpm build' first.`);
  process.exit(1);
}
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
// The font family search, and the font provider it shares with the figure exporter, are chunks that
// load only with the figure exporter.
const figure = ({ name }) => /^(?:figures|font-search|figure-fonts)-/.test(name);
// The docs chunks by source, from the manifest: their file names (README-*, heatmap-*) say too little.
const manifest = JSON.parse(readFileSync(join(dir, "..", ".vite", "manifest.json"), "utf8"));
const docsFiles = new Set(
  Object.entries(manifest)
    .filter(([source]) => /\.md\?raw$|^src\/app\/docs\//.test(source))
    .map(([, { file }]) => file.replace(/^assets\//, "")),
);
const docs = ({ name }) => docsFiles.has(name);
for (const [label, limit, group] of [
  ["app", LIMIT_GZIP, files.filter((file) => !(figure(file) || docs(file)))],
  ["figure exporter", FIGURE_LIMIT_GZIP, files.filter(figure)],
  ["docs", DOCS_LIMIT_GZIP, files.filter(docs)],
]) {
  const gzip = group.reduce((n, { bytes }) => n + gzipSync(bytes, { level: 9 }).length, 0);
  console.log(`check-bundle-size: ${label}: ${kb(gzip)} gzip (limit ${kb(limit)})`);
  if (group.length === 0 || gzip > limit) {
    console.error(`check-bundle-size: ${label} is missing or over its gzip budget.`);
    process.exit(1);
  }
}

const sw = existsSync(join(dir, "..", "sw.js")) ? readFileSync(join(dir, "..", "sw.js"), "utf8") : "";
const precached = JSON.parse(sw.match(/const ASSETS = (\[.*?\]);/)?.[1] ?? "null");
if (!precached) {
  console.error("check-bundle-size: no stamped ASSETS list in out/sw.js. Run 'pnpm build' first.");
  process.exit(1);
}
const precachedPages = JSON.parse(sw.match(/const PRECACHED_PAGES = (\[.*?\]);/)?.[1] ?? "null");
if (!precachedPages) throw new Error("check-bundle-size: no stamped PRECACHED_PAGES list in out/sw.js");
const installFiles = new Set(precached);
let pageBytes = 0;
for (const path of precachedPages) {
  const file = path === "/" ? "/index.html" : `${path}.html`;
  installFiles.add(file);
  const html = readFileSync(join(dir, "..", file), "utf8");
  pageBytes += Buffer.byteLength(html);
  for (const asset of html.match(/\/(?:assets|fonts)\/[^"'\s)\\]+\.(?:js|css|woff2)(?=["'\s)\\])/g) ?? [])
    installFiles.add(asset);
}
const sizes = [...installFiles].map((path) => ({ path, bytes: readFileSync(join(dir, "..", path)).length }));
const searchAssets = JSON.parse(sw.match(/const SEARCH_ASSETS = (\[.*?\]);/)?.[1] ?? "null");
if (!searchAssets?.length) throw new Error("check-bundle-size: no stamped SEARCH_ASSETS list in out/sw.js");
const searchBytes = searchAssets.reduce(
  (sum, path) => sum + readFileSync(join(dir, "..", path.split("?")[0])).length,
  0,
);
console.log(`check-bundle-size: docs search: ${kb(searchBytes)} raw (limit ${kb(SEARCH_LIMIT)})`);
if (searchBytes > SEARCH_LIMIT) throw new Error("check-bundle-size: docs search is over its budget");
const total = sizes.reduce((n, { bytes }) => n + bytes, 0);
const fonts = sizes.filter(({ path }) => /\.(?:ttf|otf|woff2?)$/.test(path));
const fontBytes = fonts.reduce((n, { bytes }) => n + bytes, 0);
console.log(`check-bundle-size: install precache pages: ${precachedPages.length}, ${kb(pageBytes)} raw`);
console.log(
  `check-bundle-size: install precache: ${kb(total)} raw, fonts ${kb(fontBytes)} (limit ${kb(PRECACHE_LIMIT)})`,
);
if (total > PRECACHE_LIMIT) {
  const named = fonts.length ? `; fonts: ${fonts.map(({ path }) => path).join(", ")}` : "";
  console.error(`check-bundle-size: the service worker precache is over its budget${named}.`);
  process.exit(1);
}

const core = join(import.meta.dirname, "..", "src", "core");
// Scripts off: `pnpm build` already wrote dist/, and prepack would build it again.
const packed = JSON.parse(
  execFileSync("pnpm", ["pack", "--dry-run", "--json", "--config.ignore-scripts=true"], {
    cwd: core,
    encoding: "utf8",
  }),
);
const fontFiles = packed.files.filter(({ path }) => path.endsWith(".ttf"));
if (fontFiles.length) {
  console.error(
    `check-bundle-size: fonts belong in credit-matrix-fonts, not the npm package: ${fontFiles.map(({ path }) => path).join(", ")}.`,
  );
  process.exit(1);
}
const unpacked = packed.files.reduce((n, { path }) => n + statSync(join(core, path)).size, 0);
console.log(`check-bundle-size: npm package: ${kb(unpacked)} unpacked (limit ${kb(PACKAGE_LIMIT)})`);
if (unpacked > PACKAGE_LIMIT) {
  const largest = packed.files
    .map(({ path }) => ({ path, bytes: statSync(join(core, path)).size }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3)
    .map(({ path, bytes }) => `${path} ${kb(bytes)}`);
  console.error(`check-bundle-size: the npm package is over its budget; largest files: ${largest.join(", ")}.`);
  process.exit(1);
}
