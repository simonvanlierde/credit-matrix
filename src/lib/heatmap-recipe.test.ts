// biome-ignore-all lint/correctness/noNodejsModules: execute the recipe through the real file-based CLI.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { run } from "@/core/cli";
import { loadRoleCatalog, makeRoleTranslator } from "@/core/credit-i18n";
import { loadUiCatalog, makeUiTranslator } from "@/core/credit-i18n/ui-strings";
import { buildHeatmapSvg } from "@/core/export/heatmap-svg";
import { toJson } from "@/core/export/json";
import { createAuthor } from "@/core/parse-authors";
import { heatmapRecipe } from "./heatmap-recipe";
import { DEFAULT_HEATMAP_SETTINGS } from "./heatmap-settings";

const settings = {
  ...DEFAULT_HEATMAP_SETTINGS,
  color: "#00724c",
  horizontal: true,
  legend: false,
  legendPosition: "right" as const,
  marks: true,
  acronyms: true,
  labels: "short" as const,
  shape: "circle" as const,
  font: "serif" as const,
  fontSize: 16,
  size: 12,
  skipempty: false,
};

describe("heatmap recipes", () => {
  it.each([true, false])("reproduces the SVG through the actual CLI with levels=%s", async (levels) => {
    const value = { ...settings, levels };
    const authors = [createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 33 }] })];
    const path = join(mkdtempSync(join(tmpdir(), "heatmap-recipe-")), "contributors.json");
    writeFileSync(path, toJson(authors));
    const recipe = heatmapRecipe(value, "cli", "fr");
    const args = recipe.slice("credit-matrix ".length).split(" ");
    args.splice(args.indexOf(">"));
    args[1] = path;
    const actual = await run(args.map((arg) => arg.replace(/^'|'$/g, "")));
    expect(actual.trim()).toBe(
      buildHeatmapSvg(authors, {
        ...value,
        locale: "fr",
        translateRole: makeRoleTranslator(await loadRoleCatalog("fr")),
        translateUi: makeUiTranslator(await loadUiCatalog("fr")),
      }).trim(),
    );
  });

  it("writes YAML strings safely, preserving locale and all style options", () => {
    const yaml = parseYaml(heatmapRecipe(settings, "quarto", "ja"))["credit-matrix"];
    expect(yaml).toMatchObject({
      heatmap: true,
      color: "#00724c",
      horizontal: true,
      "font-size": 16,
      font: "serif",
      initials: true,
      legend: false,
      "legend-position": "right",
      marks: true,
      labels: "short",
      skipempty: false,
      locale: "ja",
    });
    expect(yaml).not.toHaveProperty("pngDpi");
  });

  it("uses each directive's own horizontal syntax and MyST's supported data", () => {
    const sphinx = heatmapRecipe(settings, "sphinx", "de");
    expect(sphinx).toContain("   :horizontal:\n");
    expect(sphinx).not.toContain(":horizontal: true");
    expect(sphinx).toContain("   :locale: de");
    const myst = heatmapRecipe(settings, "myst", "de");
    expect(myst).toContain(":horizontal: true");
    expect(myst).toContain(":levels: false");
    expect(myst).not.toContain(":locale:");
    expect(myst).toMatch(/^:::\{credit-heatmap\}[\s\S]*\n:::$/);
  });

  it("converts CSS pixels to Typst points and uses native color syntax", () => {
    const recipe = heatmapRecipe(settings, "typst", "nl");
    expect(recipe).toContain('color: rgb("#00724c")');
    expect(recipe).toContain("size: 9pt");
    expect(recipe).toContain("font-size: 12pt");
    expect(recipe).toContain('lang: "nl"');
    expect(recipe).toContain('font: "serif"');
  });

  it("repairs unsafe stored values before producing executable snippets", () => {
    const recipe = heatmapRecipe({ ...settings, color: "$(touch bad)", fontSize: NaN }, "cli", "en; touch bad");
    expect(recipe).not.toContain("touch");
    expect(recipe).toContain("--locale en");
    expect(recipe).toContain("--font-size 10.5");
  });
});
