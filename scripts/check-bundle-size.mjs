// Fails when the JavaScript the web app ships (out/_next/static/**/*.js, every
// route's chunks together) outgrows its budget. Sizes are the sum of each
// file compressed alone, as a static host serves them. Run after `pnpm build`.
// Raise a limit on purpose, in the same commit as the change that needs it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Measured 2026-11-04: 496 kB gzip, 1530 kB raw. The limit sits about 10% above.
const LIMIT_GZIP = 545_000;

const dir = join(import.meta.dirname, "..", "out", "_next", "static");
const files = existsSync(dir)
  ? readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(dir, f)))
  : [];
if (files.length === 0) {
  console.error(`check-bundle-size: no .js files in ${dir}. Run 'pnpm build' first.`);
  process.exit(1);
}
const sum = (fn) => files.reduce((n, b) => n + fn(b), 0);
const gzip = sum((b) => gzipSync(b, { level: 9 }).length);
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
console.log(
  `check-bundle-size: ${files.length} files, ${kb(sum((b) => b.length))} raw, ${kb(gzip)} gzip (gzip limit ${kb(LIMIT_GZIP)})`,
);
if (gzip > LIMIT_GZIP) {
  console.error("check-bundle-size: over the gzip budget. Trim the bundle, or raise LIMIT_GZIP with a reason.");
  process.exit(1);
}
