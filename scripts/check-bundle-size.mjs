// biome-ignore-all lint/correctness/noNodejsModules: Node build check.
// biome-ignore-all lint/suspicious/noConsole: build diagnostics.
// Fails when the app or its separately loaded figure exporter outgrows its budget. Sizes are the sum of each
// file compressed alone, as a static host serves them. Run after `pnpm build`.
// Raise a limit on purpose, in the same commit as the change that needs it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

// Measured 2026-11-09: 397 kB gzip, 1227 kB raw. The limit sits about 10% above.
const LIMIT_GZIP = 437_000;
// Embedded-font PDF generation is loaded on export; keep its cost separate from editing.
const FIGURE_LIMIT_GZIP = 555_000;

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
