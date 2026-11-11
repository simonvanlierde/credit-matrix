// biome-ignore-all lint/correctness/noNodejsModules: greps the tracked files.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createAuthor } from "../parse-authors";
import { cast, RETIRED_PLACEHOLDERS } from "./cast";

describe("the example cast", () => {
  it("parses to the initials its comments promise", () => {
    expect(Object.fromEntries(Object.entries(cast).map(([key, name]) => [key, createAuthor(name).initials]))).toEqual({
      ada: "AL",
      rosalind: "REF",
      alan: "AMT",
      grace: "GH",
      charles: "CD",
      katherine: "KJ",
      dorothy: "DH",
      marie: "MS",
      antonie: "AL",
      antoine: "AL",
      hua: "HL",
    });
  });

  it("has replaced the retired placeholder names in every tracked file", () => {
    // The changelog is history, and cast.ts lists the names on purpose. Exit 1 means no match.
    const patterns = RETIRED_PLACEHOLDERS.flatMap((name) => ["-e", name]);
    const run = spawnSync(
      "git",
      ["grep", "-n", "-F", ...patterns, "--", ".", ":!CHANGELOG.md", ":!src/core/__tests__/cast.ts"],
      {
        cwd: new URL("../../../", import.meta.url),
        encoding: "utf8",
      },
    );
    expect(run.status, run.stderr).toBe(1);
    expect(run.stdout).toBe("");
  });
});
