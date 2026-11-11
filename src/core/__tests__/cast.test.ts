// biome-ignore-all lint/correctness/noNodejsModules: reads the tracked files.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAuthor } from "../parse-authors";
import { cast, RETIRED_PLACEHOLDERS } from "./cast";

const root = new URL("../../../", import.meta.url);

describe("the example cast", () => {
  it("parses to the initials its comments promise", () => {
    expect(Object.fromEntries(Object.entries(cast).map(([key, name]) => [key, createAuthor(name).initials]))).toEqual({
      ada: "AL",
      rosalind: "REF",
      alan: "AMT",
      grace: "GH",
      charles: "CD",
      marie: "MS",
      antonie: "AL",
      antoine: "AL",
      tu: "TY",
    });
  });

  it("has replaced the retired placeholder names in every tracked file", () => {
    // The changelog is history, and this folder names the placeholders on purpose.
    const files = execFileSync("git", ["ls-files", "--", ".", ":!CHANGELOG.md", ":!src/core/__tests__/cast*"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((path) => /\.(ts|tsx|js|mjs|json|md|mdx|typ|po|qmd|py|toml|ya?ml|xml|csv|html)$/.test(path));
    const hits = files.flatMap((path) => {
      const text = readFileSync(new URL(path, root), "utf8");
      return RETIRED_PLACEHOLDERS.filter((name) => text.includes(name)).map((name) => `${path}: ${name}`);
    });
    expect(hits).toEqual([]);
  });
});
