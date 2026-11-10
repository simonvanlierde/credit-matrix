// biome-ignore-all lint/correctness/noNodejsModules: the plugin reads front matter from disk.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES, createAuthor, generateStatement } from "@/core";
import {
  AVAILABLE_LOCALES,
  loadRoleCatalog,
  loadUiCatalog,
  makeRoleTranslator,
  makeUiTranslator,
  resolveLocaleTag,
} from "@/core/i18n";
import plugin, { authorsFor, normalizeRole, statementEntries, statementNode } from "./credit-matrix.mjs";

type Node = { type: string; value?: string; children?: Node[] };
const text = (nodes: Node[]): string => nodes.map((n) => n.value ?? text(n.children ?? [])).join("");

const examplePage = fileURLToPath(new URL("example/index.md", import.meta.url));

describe("MyST plugin", () => {
  it("normalizes roles the way MyST does", () => {
    expect(normalizeRole("conceptualisation")).toBe("Conceptualization");
    expect(normalizeRole("Writing - Review & Editing")).toBe("Writing – review & editing");
    expect(normalizeRole("admin")).toBe("Project administration");
    expect(normalizeRole("Coffee")).toBeUndefined();
  });

  it("renders one entry per author with CRediT roles, in canonical role order", () => {
    const nodes = statementNode([
      { name: "Marie Curie", roles: ["writing", "Conceptualization", "Coffee"] },
      { name: { given: "Albert", family: "Einstein" }, roles: "Investigation; analysis" },
      { name: "No Roles" },
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.[0]).toEqual({ type: "strong", children: [{ type: "text", value: "Marie Curie" }] });
    expect(text(nodes)).toBe(
      "Marie Curie: Conceptualization, Writing – original draft; Albert Einstein: Formal analysis, Investigation.",
    );
  });

  it("uses the app's by-author wording", () => {
    const marie = createAuthor("Marie Curie");
    for (const c of marie.contributions) c.score = c.role === "Software" || c.role === "Validation" ? 100 : 0;
    const app = generateStatement([marie], { format: "by-author" }).replace(/^CRediT: /, "");
    expect(text(statementNode([{ name: "Marie Curie", roles: ["Validation", "Software"] }]))).toBe(`${app}.`);
  });

  it("accepts a single author instead of a list, and skips authors without roles", () => {
    expect(text(statementNode({ name: "Marie", roles: ["Software"] }))).toBe("Marie: Software.");
    expect(statementNode("Marie Curie")).toEqual([]);
    expect(text(statementNode({ id: "123", roles: ["Software"] }))).toBe("123: Software.");
    expect(text(statementNode({ roles: ["Software"] }))).toBe(": Software.");
    expect(text(statementNode(["Marie Curie", { name: "Albert", roles: "Software" }]))).toBe("Albert: Software.");
  });

  it("renders every canonical role from the package", () => {
    for (const { name } of CREDIT_ROLES) {
      expect(text(statementNode({ name: "Marie Curie", roles: [name] }))).toBe(`Marie Curie: ${name}.`);
    }
  });

  it("uses the core's whitespace handling without interpreting a name as markup", () => {
    const name = "  Marie   Skłodowska-Curie <MC>  ";
    const author = createAuthor(name);
    for (const contribution of author.contributions) contribution.score = contribution.role === "Software" ? 100 : 0;
    expect(text(statementNode({ name, roles: ["Software"] }))).toBe(
      `${generateStatement([author], { format: "by-author" }).replace(/^CRediT: /, "")}.`,
    );
    expect(statementNode({ name, roles: ["Software"] })[0]?.children?.[0]).toEqual({
      type: "strong",
      children: [{ type: "text", value: "Marie Skłodowska-Curie <MC>" }],
    });
  });

  it("renders nothing when no author has CRediT roles", () => {
    expect(statementNode([{ name: "A" }])).toEqual([]);
    expect(statementNode(undefined)).toEqual([]);
  });

  it("reads project authors from myst.yml, and page authors replace them", () => {
    expect(authorsFor(examplePage).map((a: { name: string }) => a.name)).toEqual(["Marie Curie", "Albert Einstein"]);

    const page = join(mkdtempSync(join(tmpdir(), "credit-myst-")), "page.md");
    writeFileSync(page, "---\nauthors:\n  - name: Rosalind Franklin\n    roles: [Software]\n---\n\n# Page\n");
    expect(text(statementNode(authorsFor(page)))).toBe("Rosalind Franklin: Software.");
  });

  it("registers a credit-statement directive that renders from the page's file", () => {
    const [directive] = plugin.directives;
    expect(directive?.name).toBe("credit-statement");
    expect(text(directive?.run({}, { path: examplePage }) ?? [])).toBe(
      "Marie Curie: Conceptualization, Software, Writing – original draft; " +
        "Albert Einstein: Formal analysis, Investigation, Writing – review & editing.",
    );
  });

  it.each([
    ...AVAILABLE_LOCALES.map(({ code }) => code),
    "fr-CA",
    "de-DE",
    "pt-BR",
    "zh-CN",
    "zh-TW",
    "zh-Hant",
    "zh-HK",
    "zh-Hans-TW",
    "unknown",
  ])("uses page language %s with the core's locale fallback", async (lang) => {
    const dir = mkdtempSync(join(tmpdir(), "credit-myst-language-"));
    const page = join(dir, "index.md");
    writeFileSync(join(dir, "myst.yml"), "project:\n  lang: de\n");
    writeFileSync(
      page,
      `---\nlang: ${lang}\nauthors:\n  - name: Lin Wei\n    roles: [Software, Validation]\n  - name: Eva Novak\n    roles: [Software]\n---\n`,
    );
    const locale = resolveLocaleTag(lang) ?? "en";
    const options = {
      format: "by-author" as const,
      locale,
      translateRole: makeRoleTranslator(await loadRoleCatalog(locale)),
      translateUi: makeUiTranslator(await loadUiCatalog(locale)),
    };
    const expected = generateStatement(statementEntries(authorsFor(page)), options).replace(/^CRediT: /, "");
    expect(text(plugin.directives[0].run({}, { path: page }))).toBe(`${expected}.`);
  });

  it("inherits project language for Markdown and notebooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "credit-myst-project-language-"));
    writeFileSync(
      join(dir, "myst.yml"),
      "project:\n  lang: fr\n  authors:\n    - name: Lin Wei\n      roles: [Software]\n",
    );
    for (const extension of ["md", "ipynb"]) {
      const page = join(dir, `index.${extension}`);
      writeFileSync(page, "# Contributors\n");
      expect(text(plugin.directives[0].run({}, { path: page }))).toBe("Lin Wei\u00a0: Logiciel(s).");
    }
  });

  it("names the published version in the READMEs' plugin URL", () => {
    const { version } = JSON.parse(readFileSync(new URL("../../src/core/package.json", import.meta.url), "utf8"));
    for (const readme of ["README.md", "../jupyter-book/README.md"]) {
      expect(readFileSync(new URL(readme, import.meta.url), "utf8")).toContain(
        `https://unpkg.com/credit-matrix@${version}/dist/myst-plugin.mjs`,
      );
    }
  });
});

it("builds a heatmap SVG asset with shared options and a text alternative", () => {
  const dir = mkdtempSync(join(tmpdir(), "credit-myst-heatmap-"));
  const path = join(dir, "index.md");
  writeFileSync(path, "---\nauthors:\n  - name: Tu Youyou\n    roles: [Software]\n---\n");
  const directive = plugin.directives.find((d: { name: string }) => d.name === "credit-heatmap");
  expect(directive, "heatmap directive is registered").toBeDefined();
  const nodes = directive?.run({ options: { legend: false, size: 30, shape: "circle" } }, { path });
  expect(nodes?.[0]?.children?.[0]?.alt).toContain("Tu Youyou: Software");
  const svg = readFileSync(join(dir, nodes?.[0]?.children?.[0]?.url ?? "missing"), "utf8");
  expect(svg).toContain('width="30" height="30" rx="15"');
  expect(svg).not.toContain(">Supporting<");
});

it("labels heatmap columns with each author's full name", () => {
  const dir = mkdtempSync(join(tmpdir(), "credit-myst-names-"));
  const path = join(dir, "index.md");
  writeFileSync(
    path,
    "---\nauthors:\n  - name: Tu Youyou\n    roles: [Software]\n  - name: Katherine Johnson\n    roles: [Software]\n---\n",
  );
  const directive = plugin.directives.find((d: { name: string }) => d.name === "credit-heatmap");
  const nodes = directive?.run({ options: {} }, { path });
  const svg = readFileSync(join(dir, nodes?.[0]?.children?.[0]?.url ?? "missing"), "utf8");
  expect(svg).toContain(">Tu Youyou<");
  expect(svg).toContain(">Katherine Johnson<");
  expect(svg).not.toContain(">C<");
});
