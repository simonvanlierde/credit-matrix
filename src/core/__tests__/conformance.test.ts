// biome-ignore lint/correctness/noNodejsModules: tests run in Node; the suite is files on disk
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEVEL_SCORE } from "../author";
import { getRoleByName } from "../credit-roles";
import { toJats4rXml } from "../export/xml";
import { createAuthor } from "../parse-authors";

// The suite's input format is described in conformance/README.md.
interface Case {
  mode: "levels" | "yes-no";
  contributors: {
    givenNames: string;
    surname: string;
    orcid?: string;
    type?: "author" | "non-author";
    equalContribution?: boolean;
    corresponding?: boolean;
    roles: Record<string, "lead" | "equal" | "supporting" | "yes">;
  }[];
}

const dir = "conformance/cases";
const names = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -".json".length));

function exportCase(name: string): string {
  const { mode, contributors }: Case = JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
  const authors = contributors.map((c) =>
    createAuthor(`${c.givenNames} ${c.surname}`, {
      surname: c.surname,
      orcid: c.orcid,
      contributorType: c.type,
      equalContribution: c.equalContribution,
      corresponding: c.corresponding,
      contributions: Object.entries(c.roles).map(([role, level]) => ({
        role: getRoleByName(role).name,
        score: level === "yes" ? 100 : LEVEL_SCORE[level],
      })),
    }),
  );
  return `${toJats4rXml(authors, { yesNo: mode === "yes-no" })}\n`;
}

describe("JATS conformance suite", () => {
  it("has cases", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)("%s", async (name) => {
    // A missing expected file is written on a local run and fails in CI.
    await expect(exportCase(name)).toMatchFileSnapshot(`../../../${dir}/${name}.xml`);
  });
});
