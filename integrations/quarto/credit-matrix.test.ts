// biome-ignore-all lint/correctness/noNodejsModules: runs Quarto from Node when it is installed.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAuthor, generateStatement } from "@/core";

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

describe.skipIf(spawnSync("quarto", ["--version"]).status !== 0)("Quarto filter, rendered", () => {
  it("renders the statement into example.qmd", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const md = execFileSync("quarto", ["render", "example.qmd", "--to", "gfm", "-o", "-"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(md).toContain("# CRediT authorship contribution statement");
    expect(md.replaceAll("**", "").replace(/\s+/g, " ")).toContain(EXPECTED);
  });
});
