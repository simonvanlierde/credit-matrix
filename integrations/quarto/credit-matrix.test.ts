// biome-ignore-all lint/correctness/noNodejsModules: runs Quarto from Node when it is installed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES, createAuthor, generateStatement, toQuarto } from "@/core";
import * as i18n from "@/core/i18n";
import { renderQuartoTranslations } from "../../scripts/build-quarto-translations.mjs";

// What the filter renders for example.qmd, without the Markdown bold around each name.
const EXPECTED =
  "Marie Curie: Conceptualization, Software (Supporting), Writing – original draft; " +
  "Albert Einstein: Formal analysis (Equal), Investigation, Writing – review & editing.";

function author(name: string, scores: Record<string, number>) {
  const a = createAuthor(name);
  for (const c of a.contributions) c.score = scores[c.role] ?? 0;
  return a;
}

describe("Quarto filter", () => {
  it("matches the app's by-author wording for the example's roles", () => {
    const authors = [
      author("Marie Curie", { Conceptualization: 100, Software: 33, "Writing – original draft": 100 }),
      author("Albert Einstein", { Investigation: 100, "Formal analysis": 66, "Writing – review & editing": 100 }),
    ];
    const statement = generateStatement(authors, { format: "by-author", showLevels: true });
    expect(`${statement.replace(/^CRediT: /, "")}.`).toBe(EXPECTED);
  });
});

it("keeps the Lua role list in step with the core role names", () => {
  const lua = readFileSync(new URL("_extensions/credit-matrix/credit-matrix.lua", import.meta.url), "utf8");
  const block = /local CREDIT_TERMS = \{([\s\S]*?)\n\}/.exec(lua)?.[1] ?? "";
  const terms = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  expect(terms).toEqual(CREDIT_ROLES.map((r: { name: string }) => r.name.toLowerCase()));
});

it("keeps every Lua translation in step with the core and app catalogs", async () => {
  const lua = readFileSync(new URL("_extensions/credit-matrix/credit-matrix.lua", import.meta.url), "utf8");
  expect(lua.match(/-- BEGIN GENERATED TRANSLATIONS[\s\S]*?-- END GENERATED TRANSLATIONS/)?.[0]).toBe(
    await renderQuartoTranslations(i18n, CREDIT_ROLES),
  );
});

// Locally the rendered test is skipped without Quarto; in CI a missing Quarto fails it.
const hasQuarto = spawnSync("quarto", ["--version"]).status === 0;

describe.skipIf(!hasQuarto && !process.env.CI)("Quarto filter, rendered", () => {
  it.each([
    ["fr-CA", "fr", "Déclaration CRediT"],
    ["ja-JP", "ja", "CRediT 声明"],
  ])("uses document language %s for roles, levels and heading", async (lang, locale, heading) => {
    expect(hasQuarto, "quarto is not installed but CI is set").toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "credit-quarto-language-"));
    const filter = fileURLToPath(new URL("_extensions/credit-matrix/credit-matrix.lua", import.meta.url));
    writeFileSync(
      join(dir, "paper.qmd"),
      `---\nlang: ${lang}\nauthor:\n  - name: Lin Wei\n    roles: [software: supporting, validation: equal]\nfilters: [${JSON.stringify(filter)}]\n---\n\n# Methods\n`,
    );
    const result = spawnSync("quarto", ["render", "paper.qmd", "--to", "gfm", "-o", "-"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const expected = generateStatement([author("Lin Wei", { Software: 33, Validation: 66 })], {
      format: "by-author",
      showLevels: true,
      locale,
      translateRole: i18n.makeRoleTranslator(await i18n.loadRoleCatalog(locale)),
      translateUi: i18n.makeUiTranslator(await i18n.loadUiCatalog(locale)),
    }).replace(/^CRediT: /, "");
    expect(result.stdout).toContain(heading);
    expect(result.stdout.replaceAll("**", "")).toContain(`${expected}.`);
  });

  it.each(["by-role", "table"])("renders the %s format through Quarto", (format) => {
    expect(hasQuarto, "quarto is not installed but CI is set").toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "credit-quarto-format-"));
    const filter = fileURLToPath(new URL("_extensions/credit-matrix/credit-matrix.lua", import.meta.url));
    writeFileSync(
      join(dir, "paper.qmd"),
      `---\nauthor:\n  - name: Tu Youyou\n    roles: [software: supporting, validation]\ncredit-matrix:\n  format: ${format}\nfilters: [${JSON.stringify(filter)}]\n---\n\n# Methods\n`,
    );
    const result = spawnSync("quarto", ["render", "paper.qmd", "--to", "gfm", "-o", "-"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    if (format === "by-role") {
      expect(result.stdout.replaceAll("**", "")).toContain("Software: Tu Youyou (Supporting); Validation: Tu Youyou.");
    } else {
      expect(result.stdout).toMatch(/\|\s*Tu Youyou\s*\|/);
      expect(result.stdout).toMatch(/\|\s*Software\s*\|\s*Supporting\s*\|/);
      expect(result.stdout).toMatch(/\|\s*Validation\s*\|\s*Lead\s*\|/);
    }
  });

  it("renders exported YAML with the app's contribution levels", () => {
    expect(hasQuarto, "quarto is not installed but CI is set").toBe(true);
    const authors = [author("Lin Wei", { Software: 33, "Formal analysis": 66 })];
    const dir = mkdtempSync(join(tmpdir(), "credit-quarto-export-"));
    const filter = fileURLToPath(new URL("_extensions/credit-matrix/credit-matrix.lua", import.meta.url));
    writeFileSync(
      join(dir, "paper.qmd"),
      `---\n${toQuarto(authors)}filters: [${JSON.stringify(filter)}]\n---\n\n# Methods\n`,
    );
    const result = spawnSync("quarto", ["render", "paper.qmd", "--to", "gfm", "-o", "-"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const expected = generateStatement(authors, { format: "by-author", showLevels: true }).replace(/^CRediT: /, "");
    expect(result.stdout.replaceAll("**", "").replace(/\s+/g, " ")).toContain(`${expected}.`);
  });

  it("renders the statement into example.qmd", () => {
    expect(hasQuarto, "quarto is not installed but CI is set").toBe(true);
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const run = spawnSync("quarto", ["render", "example.qmd", "--to", "gfm", "-o", "-"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const md = run.stdout;
    expect(md).toContain("# CRediT authorship contribution statement");
    expect(md.replaceAll("**", "").replace(/\s+/g, " ")).toContain(EXPECTED);
  });
});

it("keeps the extension version in step with the package", () => {
  const extension = readFileSync(new URL("_extensions/credit-matrix/_extension.yml", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(extension).toContain(`version: ${pkg.version}\n`);
});
