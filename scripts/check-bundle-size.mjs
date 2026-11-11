// biome-ignore-all lint/correctness/noNodejsModules: Node build check.
// biome-ignore-all lint/suspicious/noConsole: build diagnostics.
// Fails when the app or its separately loaded figure exporter outgrows its budget, or when the service worker's
// install precache grows (a figure font in it costs every first visit megabytes). Script sizes are the sum of
// each file compressed alone, as a static host serves them; the precache is raw bytes. Run after `pnpm build`.
// Raise a limit on purpose, in the same commit as the change that needs it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

// Measured 2026-11-09: 397 kB gzip, 1227 kB raw. The limit sits about 10% above.
const LIMIT_GZIP = 437_000;
// Embedded-font PDF generation is loaded on export; keep its cost separate from editing.
const FIGURE_LIMIT_GZIP = 555_000;
// Measured 2026-11-11: 2.52 MB of scripts and styles plus Noto Sans (0.57 MB), the one figure font
// precached. Any other figure font is 0.62-14.9 MB.
const PRECACHE_LIMIT = 3_200_000;

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
for (const [label, limit, group] of [
  ["app", LIMIT_GZIP, files.filter(({ name }) => !name.startsWith("figures-"))],
  ["figure exporter", FIGURE_LIMIT_GZIP, files.filter(({ name }) => name.startsWith("figures-"))],
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
const sizes = precached.map((path) => ({ path, bytes: readFileSync(join(dir, "..", path)).length }));
const total = sizes.reduce((n, { bytes }) => n + bytes, 0);
const fonts = sizes.filter(({ path }) => /\.(?:ttf|otf|woff2?)$/.test(path));
const fontBytes = fonts.reduce((n, { bytes }) => n + bytes, 0);
console.log(
  `check-bundle-size: install precache: ${kb(total)} raw, fonts ${kb(fontBytes)} (limit ${kb(PRECACHE_LIMIT)})`,
);
if (total > PRECACHE_LIMIT) {
  const named = fonts.length ? `; fonts: ${fonts.map(({ path }) => path).join(", ")}` : "";
  console.error(`check-bundle-size: the service worker precache is over its budget${named}.`);
  process.exit(1);
}
