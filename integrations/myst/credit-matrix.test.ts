// biome-ignore-all lint/correctness/noNodejsModules: the plugin reads front matter from disk.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAuthor, generateStatement } from "@/core";
import plugin, { authorsFor, normalizeRole, statementNode } from "./credit-matrix.mjs";

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
      { name: "Jane A. Smith", roles: ["writing", "Conceptualization", "Coffee"] },
      { name: { given: "Bob", family: "White" }, roles: "Investigation; analysis" },
      { name: "No Roles" },
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.[0]).toEqual({ type: "strong", children: [{ type: "text", value: "Jane A. Smith" }] });
    expect(text(nodes)).toBe(
      "Jane A. Smith: Conceptualization, Writing – original draft; Bob White: Formal analysis, Investigation.",
    );
  });

  it("uses the app's by-author wording", () => {
    const jane = createAuthor("Jane A. Smith");
    for (const c of jane.contributions) c.score = c.role === "Software" || c.role === "Validation" ? 100 : 0;
    const app = generateStatement([jane], { format: "by-author" }).replace(/^CRediT: /, "");
    expect(text(statementNode([{ name: "Jane A. Smith", roles: ["Validation", "Software"] }]))).toBe(`${app}.`);
  });

  it("renders nothing when no author has CRediT roles", () => {
    expect(statementNode([{ name: "A" }])).toEqual([]);
    expect(statementNode(undefined)).toEqual([]);
  });

  it("reads project authors from myst.yml, and page authors replace them", () => {
    expect(authorsFor(examplePage).map((a: { name: string }) => a.name)).toEqual(["Jane A. Smith", "Bob White"]);

    const page = join(mkdtempSync(join(tmpdir(), "credit-myst-")), "page.md");
    writeFileSync(page, "---\nauthors:\n  - name: Ann Lee\n    roles: [Software]\n---\n\n# Page\n");
    expect(text(statementNode(authorsFor(page)))).toBe("Ann Lee: Software.");
  });

  it("registers a credit-statement directive that renders from the page's file", () => {
    const [directive] = plugin.directives;
    expect(directive?.name).toBe("credit-statement");
    expect(text(directive?.run({}, { path: examplePage }) ?? [])).toBe(
      "Jane A. Smith: Conceptualization, Software, Writing – original draft; " +
        "Bob White: Formal analysis, Investigation, Writing – review & editing.",
    );
  });
});
