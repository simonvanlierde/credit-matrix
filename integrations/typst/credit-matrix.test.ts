// biome-ignore-all lint/correctness/noNodejsModules: runs Typst from Node when it is installed.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES, createAuthor, fromJson, generateStatement, type StatementFormat } from "@/core";
import * as i18n from "@/core/i18n";
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
  it("compiles every example", () => {
    expect(hasTypst, "typst is not installed but CI is set").toBe(true);
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    for (const name of ["basic", "team"]) {
      const run = typst("compile", "--root", ".", `examples/${name}.typ`, `out/${name}.pdf`);
      expect(run.status, run.stderr).toBe(0);
    }
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
      author("Jane A. Smith", { Conceptualization: 100, Software: 33, "Writing – original draft": 100 }),
      author("Bob White", { Investigation: 100, "Formal analysis": 66, "Writing – review & editing": 100 }),
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
  ])("maps the document language %s to the %s catalog", async (docLang, locale) => {
    mkdirSync(new URL("out", import.meta.url), { recursive: true });
    const file = `out/lang-${docLang}.typ`;
    writeFileSync(
      new URL(file, import.meta.url),
      `#import "../lib.typ": *\n#set text(lang: "${docLang}")\n#credit-statement(((name: "Ana", roles: (conceptualization: true)),))`,
    );
    expect(autoStatement(file)).toBe(await appStatement1(["Ana"], locale, false));
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
