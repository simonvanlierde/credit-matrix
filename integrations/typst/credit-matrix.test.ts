// biome-ignore-all lint/correctness/noNodejsModules: runs Typst from Node when it is installed.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES, createAuthor, fromJson, generateStatement, type StatementFormat } from "@/core";
import * as i18n from "@/core/i18n";
import { heatmapRecipe } from "@/lib/heatmap-recipe";
import { DEFAULT_HEATMAP_SETTINGS } from "@/lib/heatmap-settings";
import { renderTypstTranslations } from "../../scripts/build-typst-translations.mjs";

const dir = fileURLToPath(new URL(".", import.meta.url));

it("keeps translations.json in step with the core catalogs", async () => {
  const committed = readFileSync(new URL("translations.json", import.meta.url), "utf8");
  // Regenerate with: pnpm --filter credit-matrix build && node scripts/build-typst-translations.mjs
  expect(committed).toBe(await renderTypstTranslations(i18n, CREDIT_ROLES));
});

it("names the same version in typst.toml and the README's import line", () => {
  const version = /^version = "(.+)"$/m.exec(readFileSync(new URL("typst.toml", import.meta.url), "utf8"))?.[1];
  expect(readFileSync(new URL("README.md", import.meta.url), "utf8")).toContain(`@preview/credit-matrix:${version}`);
});

async function appStatement(json: string, format: StatementFormat, showLevels: boolean, locale: string) {
  return generateStatement(fromJson(json).authors, {
    format,
    showLevels,
    locale,
    translateRole: i18n.makeRoleTranslator(await i18n.loadRoleCatalog(locale)),
    translateUi: i18n.makeUiTranslator(await i18n.loadUiCatalog(locale)),
  });
}

function typst(...args: string[]) {
  return spawnSync("typst", args, { cwd: dir, encoding: "utf8" });
}

/** The by-author statement for people who all hold Conceptualization, in the app's own wording. */
async function appStatement1(names: string[], locale: string, equal: boolean) {
  const authors = names.map((name) => {
    const a = createAuthor(name);
    for (const c of a.contributions) c.score = c.role === "Conceptualization" ? 100 : 0;
    a.equalContribution = equal;
    return a;
  });
  return generateStatement(authors, {
    format: "by-author",
    showLevels: false,
    locale,
    translateRole: i18n.makeRoleTranslator(await i18n.loadRoleCatalog(locale)),
    translateUi: i18n.makeUiTranslator(await i18n.loadUiCatalog(locale)),
  });
}

/** The text a document's `credit-statement` leaves behind for `query`. */
function autoStatement(file: string): string {
  const run = typst("query", "--root", ".", file, "<credit-statement>", "--field", "value", "--one");
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout);
}

// Locally the rendered tests are skipped without Typst; in CI a missing Typst fails them.
const hasTypst = spawnSync("typst", ["--version"]).status === 0;

describe.skipIf(!hasTypst && !process.env.CI)("Typst package, compiled", () => {
  it.each([true, false])("keeps publication figures free of cell marks with levels=%s unless requested", (levels) => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("out/without-marks.typ", import.meta.url),
      `#import "../lib.typ": *\n#set page(width: auto, height: auto)\n#credit-heatmap(((name: "Tu Youyou", roles: (software: "supporting")),), levels: ${levels})`,
    );
    const result = typst("compile", "--root", ".", "out/without-marks.typ", "out/without-marks.svg");
    expect(result.status, result.stderr).toBe(0);
    const svg = readFileSync(new URL("out/without-marks.svg", import.meta.url), "utf8");
    expect(svg).not.toMatch(/<path fill="#[a-f0-9]+"[^>]+d="M 0 0m /);
    expect(svg).not.toMatch(/<use[^>]+fill="#ffffff"/);
  });

  it.each([
    ["marks: 1", "marks must be true or false"],
    ['legend-position: "sideways"', "legend-position must be auto, right or bottom"],
  ])("rejects invalid figure controls: %s", (option, message) => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("out/invalid-control.typ", import.meta.url),
      `#import "../lib.typ": *\n#credit-heatmap((), ${option})`,
    );
    const result = typst("compile", "--root", ".", "out/invalid-control.typ", "out/invalid-control.svg");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it("places a compact key beside tall matrices and below wide matrices", () => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const dimensions = (count: number, position: string, legend = true) => {
      const people = Array.from(
        { length: count },
        (_, i) => `(name: "Marie Skłodowska-Curie ${i}", roles: (software: true))`,
      ).join(",");
      writeFileSync(
        new URL("out/legend-position.typ", import.meta.url),
        `#import "../lib.typ": *\n#set page(width: auto, height: auto)\n#credit-heatmap((${people},), skipempty: false, legend-position: "${position}", legend: ${legend})`,
      );
      const run = typst("compile", "--root", ".", "out/legend-position.typ", "out/legend-position.svg");
      expect(run.status, run.stderr).toBe(0);
      return (
        /viewBox="0 0 ([\d.]+) ([\d.]+)"/
          .exec(readFileSync(new URL("out/legend-position.svg", import.meta.url), "utf8"))
          ?.slice(1)
          .map(Number) ?? []
      );
    };
    const below = dimensions(2, "bottom");
    const right = dimensions(2, "right");
    expect(right[0]).toBeGreaterThan(below[0] ?? 0);
    expect(right[1]).toBeLessThan(below[1] ?? 0);
    expect(dimensions(2, "auto")).toEqual(right);
    expect(dimensions(16, "auto")).toEqual(dimensions(16, "bottom"));
    expect(dimensions(2, "right", false)).toEqual(dimensions(2, "bottom", false));
  });

  it("compiles the app's copied heatmap recipe", () => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const recipe = heatmapRecipe({ ...DEFAULT_HEATMAP_SETTINGS, font: "serif", horizontal: true }, "typst", "fr");
    writeFileSync(
      new URL("out/recipe.typ", import.meta.url),
      `#import "../lib.typ": *\n#set page(width: auto, height: auto)\n#let team = ((name: "Ada Lovelace", roles: (software: true)),)\n${recipe}`,
    );
    const result = typst("compile", "--root", ".", "out/recipe.typ", "out/recipe.svg");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(new URL("out/recipe.svg", import.meta.url), "utf8")).toContain("<svg");
  });
  it("includes an earlier long header in the canvas bounds", () => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const width = (labels: string[]) => {
      const team = labels.map((name) => `(name: "${name}", roles: (software: true))`).join(",");
      writeFileSync(
        new URL("out/mixed-type.typ", import.meta.url),
        `#import "../lib.typ": *\n#set page(width: auto, height: auto)\n#credit-heatmap((${team},), initials: false, legend: false)`,
      );
      const run = typst("compile", "--root", ".", "out/mixed-type.typ", "out/mixed-type.svg");
      expect(run.status, run.stderr).toBe(0);
      return Number(
        /viewBox="0 0 ([\d.]+)/.exec(readFileSync(new URL("out/mixed-type.svg", import.meta.url), "utf8"))?.[1],
      );
    };
    const names = ["Alexandra Montgomery Rivera 1", "Li"];
    // Moving a header one column changes its reach by at most the 16 pt column pitch.
    expect(width([...names].reverse()) - width(names)).toBeLessThanOrEqual(16.01);
  });

  it("separates rotated large-font headers above small cells", () => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const width = (count: number) => {
      const person = `(name: "${"É".repeat(20)}", roles: (software: true))`;
      writeFileSync(
        new URL("out/large-type.typ", import.meta.url),
        `#import "../lib.typ": *\n#set page(width: auto, height: auto)\n#credit-heatmap((${Array(count).fill(person).join(",")},), font-size: 24pt, size: 14pt, legend: false)`,
      );
      const run = typst("compile", "--root", ".", "out/large-type.typ", "out/large-type.svg");
      expect(run.status, run.stderr).toBe(0);
      return Number(
        /viewBox="0 0 ([\d.]+)/.exec(readFileSync(new URL("out/large-type.svg", import.meta.url), "utf8"))?.[1],
      );
    };
    expect((width(2) - width(1)) * Math.SQRT1_2).toBeGreaterThanOrEqual(28);
  });

  it.each([
    [
      '((name: "Marie Skłodowska-Curie", initials: "MSC", roles: (software: true)),)',
      '((name: "MSC", roles: (software: true)),)',
    ],
    ['((name: "Émile 𐐀smith", roles: (software: true)),)', '((name: "É𐐀", roles: (software: true)),)'],
    ['((name: "王小明", roles: (software: true)),)', '((name: "王小明", roles: (software: true)),)'],
    [
      '((name: "Ada Lovelace", roles: (software: true)), (name: "Antonie van Leeuwenhoek", roles: (software: true)))',
      '((name: "Ada Lovelace", roles: (software: true)), (name: "Antonie van Leeuwenhoek", roles: (software: true)))',
    ],
  ])("uses unambiguous Unicode initials for %s", (people, expected) => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const dimensions = (input: string, initials: boolean) => {
      writeFileSync(
        new URL("out/initials.typ", import.meta.url),
        `#import "../lib.typ": *\n#set page(width: auto, height: auto)\n#credit-heatmap(${input}, initials: ${initials})`,
      );
      const run = typst("compile", "--root", ".", "out/initials.typ", "out/initials.svg");
      expect(run.status, run.stderr).toBe(0);
      return /viewBox="([^"]+)"/.exec(readFileSync(new URL("out/initials.svg", import.meta.url), "utf8"))?.[1];
    };
    expect(dimensions(people, true)).toBe(dimensions(expected, false));
  });

  it("renders typography options and non-color level marks", () => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("out/typography.typ", import.meta.url),
      '#import "../lib.typ": *\n#set page(width: auto, height: auto)\n#let team = ((name: "Tu Youyou", roles: (software: "supporting", methodology: "equal", conceptualization: "lead")),)\n#credit-heatmap(team, font: "serif", font-size: 12pt, marks: true)\n#credit-heatmap(team, levels: false, color: rgb("#f0e442"), marks: true)\n#credit-heatmap(team, levels: false, marks: true)',
    );
    const run = typst("compile", "--root", ".", "out/typography.typ", "out/typography.svg");
    expect(run.status, run.stderr).toBe(0);
    const svg = readFileSync(new URL("out/typography.svg", import.meta.url), "utf8");
    expect(svg.match(/<path fill="#[a-f0-9]+"[^>]+d="M 0 0m /g)).toHaveLength(12);
    expect(svg.match(/<use[^>]+fill="#ffffff"/g)).toHaveLength(4);
    expect(svg).toContain('fill="#16181c"');
  });

  it("compiles every example", () => {
    expect(hasTypst, "typst is not installed but CI is set").toBe(true);
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    for (const name of ["basic", "team"]) {
      const run = typst("compile", "--root", ".", `examples/${name}.typ`, `out/${name}.pdf`);
      expect(run.status, run.stderr).toBe(0);
    }
  });

  it("compiles every heatmap shape and palette with either orientation", () => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const calls = ["blue", "green", "gray"].flatMap((palette) =>
      ["square", "rounded", "circle"].flatMap((shape) =>
        [false, true].map(
          (horizontal) =>
            `#credit-heatmap(team, palette: "${palette}", shape: "${shape}", horizontal: ${horizontal}, size: 18pt, labels: "short", legend: false, skipempty: false)`,
        ),
      ),
    );
    writeFileSync(
      new URL("out/options.typ", import.meta.url),
      '#import "../lib.typ": *\n#set page(width: auto, height: auto)\n#let team = ((name: "Tu Youyou", roles: (software: "supporting", methodology: "equal")),)\n' +
        calls.join("\n"),
    );
    const run = typst("compile", "--root", ".", "out/options.typ", "out/options.svg");
    expect(run.status, run.stderr).toBe(0);
    const svg = readFileSync(new URL("out/options.svg", import.meta.url), "utf8");
    expect(svg).toContain('fill="#99c7b7"');
    expect(svg).toContain('stroke="#c9c9c5"');
  });

  it.each(["es", "ja", "de"])("cuts short role labels on characters, not bytes, for %s", (lang) => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    writeFileSync(
      new URL(`out/short-${lang}.typ`, import.meta.url),
      `#import "../lib.typ": *\n#credit-heatmap(((name: "Tu Youyou", roles: (software: "supporting")),), lang: "${lang}", labels: "short", skipempty: false)`,
    );
    const run = typst("compile", "--root", ".", `out/short-${lang}.typ`, `out/short-${lang}.svg`);
    expect(run.status, run.stderr).toBe(0);
  });

  it("writes the app's statement for its JSON export, in every format, level setting and language", async () => {
    const json = readFileSync(new URL("examples/team.json", import.meta.url), "utf8");
    const cases = ["en", "fr", "ja"].flatMap((lang) =>
      (["by-role", "by-author"] as const).flatMap((format) =>
        [false, true].map((levels) => ({ lang, format, levels })),
      ),
    );
    const calls = cases.map(
      ({ lang, format, levels }) =>
        `credit-statement-text(team, format: "${format}", levels: ${levels}, lang: "${lang}")`,
    );
    const run = typst("eval", `import "lib.typ": *; let team = json("examples/team.json"); (${calls.join(", ")})`);
    expect(run.status, run.stderr).toBe(0);
    const expected = await Promise.all(cases.map((c) => appStatement(json, c.format, c.levels, c.lang)));
    expect(JSON.parse(run.stdout)).toEqual(expected);
  });

  it("takes the document's language and inline roles in basic.typ", () => {
    const author = (name: string, scores: Record<string, number>) => {
      const a = createAuthor(name);
      for (const c of a.contributions) c.score = scores[c.role] ?? 0;
      return a;
    };
    const authors = [
      author("Marie Skłodowska-Curie", { Conceptualization: 100, Software: 33, "Writing – original draft": 100 }),
      author("Antonie van Leeuwenhoek", {
        Investigation: 100,
        "Formal analysis": 66,
        "Writing – review & editing": 100,
      }),
    ];
    const run = typst("eval", "--root", ".", "--in", "examples/basic.typ", "query(<credit-statement>).first().value");
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toBe(generateStatement(authors, { format: "by-author", showLevels: true }));
  });

  it("follows the app's French statement for lang: auto in team.typ", async () => {
    const json = readFileSync(new URL("examples/team.json", import.meta.url), "utf8");
    expect(autoStatement("examples/team.typ")).toBe(await appStatement(json, "by-role", true, "fr"));
  });

  it.each([
    ["pt", "pt-PT"],
    ["zh", "zh-Hans"],
    ["ru", "en"], // no catalog: falls back to English
    ['zh", region: "TW', "en"], // Traditional Chinese: English, not Simplified
    ['zh", region: "CN', "zh-Hans"],
  ])("maps the document language %s to the %s catalog", async (docLang, locale) => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const file = `out/lang-${docLang.replace(/\W+/g, "-")}.typ`;
    writeFileSync(
      new URL(file, import.meta.url),
      `#import "../lib.typ": *\n#set text(lang: "${docLang}")\n#credit-statement(((name: "Ana", roles: (conceptualization: true)),))`,
    );
    expect(autoStatement(file)).toBe(await appStatement1(["Ana"], locale, false));
  });

  it("keeps Simplified Chinese for zh-Hans-TW", async () => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const file = "out/lang-zh-Hans-TW.typ";
    writeFileSync(
      new URL(file, import.meta.url),
      `#import "../lib.typ": *\n#credit-statement(((name: "Ana", roles: (conceptualization: true)),), lang: "zh-Hans-TW")`,
    );
    expect(autoStatement(file)).toBe(await appStatement1(["Ana"], "zh-Hans", false));
  });

  it("joins Spanish names like ICU, with e before an i sound", async () => {
    const cases = ["Isabel", "Ignacio", "Hilda", "Íñigo", "Hierro", "Hiena", "Olga"].map((b) => ["Ana", b]);
    const person = (n: string) => `(name: "${n}", roles: (conceptualization: true), equal-contribution: true)`;
    const calls = cases.map(([a, b]) => `credit-statement-text((${person(a)}, ${person(b)}), lang: "es")`);
    const run = typst("eval", `import "lib.typ": *; (${calls.join(", ")})`);
    expect(run.status, run.stderr).toBe(0);
    const expected = await Promise.all(cases.map((pair) => appStatement1(pair, "es", true)));
    expect(JSON.parse(run.stdout)).toEqual(expected);
    expect(expected[0]).toContain("Ana e Isabel");
    expect(expected[3]).toContain("Ana y Íñigo");
  });

  it("stops on an explicit language the package lacks", () => {
    const run = typst(
      "eval",
      'import "lib.typ": *; credit-statement-text(((name: "A", roles: (conceptualization: true)),), lang: "ru")',
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('no translations for lang "ru"');
  });

  it("stops on a fractional score", () => {
    const run = typst(
      "eval",
      'import "lib.typ": *; credit-statement-text(((name: "A", roles: (software: 33.4)),), lang: "en")',
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("whole score");
  });

  it("stops with a message naming an unknown role", () => {
    const run = typst(
      "eval",
      'import "lib.typ": *; credit-statement-text(((name: "A", roles: (coffee: true)),), lang: "en")',
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('unknown CRediT role "coffee" for A');
  });
});
