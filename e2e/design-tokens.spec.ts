// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import { readFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import process from "node:process";
import { expect, test } from "@playwright/test";

/**
 * DESIGN.md's front matter hand-mirrors the tokens defined in globals.css.
 * Nothing else ties them together, so the doc could drift silently and a
 * reader would trust a swatch the app no longer uses. This asserts the colors
 * still agree; the cheapest thing that fails when someone changes one side.
 *
 * Lives in the Playwright suite (rather than src/core) because it reads
 * repo files, not core's public API.
 */
// Playwright resolves testDir from the repo root, so cwd is the repo root.
const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

/** The `name: "#rrggbb"` pairs from DESIGN.md's `colors:` block. */
function designColors(): Map<string, string> {
  const md = read("DESIGN.md");
  const block = md.split(/^colors:$/m)[1]?.split(/^\w+:/m)[0] ?? "";
  const found = new Map<string, string>();
  for (const [, name, hex] of block.matchAll(/^\s{2}([\w-]+):\s*"(#[0-9a-fA-F]{6})"/gm)) {
    if (name && hex) found.set(name, hex.toLowerCase());
  }
  return found;
}

/** Custom properties from the `:root` block of globals.css. */
function cssVars(): Map<string, string> {
  const css = read("src/app/globals.css");
  const root = css.split(":root {")[1]?.split("\n}")[0] ?? "";
  const found = new Map<string, string>();
  for (const [, name, value] of root.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)) {
    if (name && value) found.set(name, value.trim().toLowerCase());
  }
  return found;
}

// DESIGN.md token name -> the CSS custom property it documents.
const MIRRORED: [string, string][] = [
  ["ink-blue", "color-primary"],
  ["paper-bright", "color-surface-bright"],
  ["graphite", "color-on-surface"],
  ["error", "color-error"],
];

test.describe("design token drift", () => {
  test("DESIGN.md colors still match globals.css", () => {
    const design = designColors();
    const css = cssVars();
    expect(design.size, "no colors parsed out of DESIGN.md").toBeGreaterThan(0);

    for (const [docName, cssName] of MIRRORED) {
      const documented = design.get(docName);
      const actual = css.get(cssName);
      expect(documented, `DESIGN.md is missing the ${docName} color`).toBeTruthy();
      expect(actual, `globals.css is missing --${cssName}`).toBeTruthy();
      expect(actual, `DESIGN.md says ${docName} is ${documented}, globals.css says --${cssName} is ${actual}`).toBe(
        documented,
      );
    }
  });
});
