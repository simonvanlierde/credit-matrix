// biome-ignore-all lint/correctness/noNodejsModules: runs Quarto from Node when it is installed.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CREDIT_ROLES, createAuthor, generateStatement } from "@/core";

// What the filter renders for example.qmd, without the Markdown bold around each name.
const EXPECTED =
  "Jane A. Smith: Conceptualization, Software (Supporting), Writing – original draft; " +
  "Bob White: Formal analysis (Equal), Investigation, Writing – review & editing.";

function author(name: string, scores: Record<string, number>) {
  const a = createAuthor(name);
  for (const c of a.contributions) c.score = scores[c.role] ?? 0;
  return a;
}

describe("Quarto filter", () => {
  it("matches the app's by-author wording for the example's roles", () => {
    const authors = [
      author("Jane A. Smith", { Conceptualization: 100, Software: 33, "Writing – original draft": 100 }),
      author("Bob White", { Investigation: 100, "Formal analysis": 66, "Writing – review & editing": 100 }),
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

// Locally the rendered test is skipped without Quarto; in CI a missing Quarto fails it.
const hasQuarto = spawnSync("quarto", ["--version"]).status === 0;

describe.skipIf(!hasQuarto && !process.env.CI)("Quarto filter, rendered", () => {
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
