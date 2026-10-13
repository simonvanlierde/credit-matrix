// biome-ignore lint/correctness/noNodejsModules: tests run in Node; fixtures are files on disk
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Author } from "../author";
import { fromTenzing, isTenzing } from "../export/tenzing";

function fixture(name: string): string {
  return readFileSync(`src/core/__tests__/fixtures/${name}`, "utf8");
}

function roles(author: Author | undefined): string[] {
  return (author?.contributions ?? []).filter((c) => c.score > 0).map((c) => `${c.role}:${c.score}`);
}

const ANA_ROLES = [
  "Conceptualization:100",
  "Funding acquisition:100",
  "Methodology:100",
  "Supervision:100",
  "Writing – original draft:100",
  "Writing – review & editing:100",
];

describe("fromTenzing", () => {
  it("reads tenzing's example CSV layout in publication order", () => {
    const [ana, bob, carol, ...rest] = fromTenzing(fixture("tenzing.csv"));
    expect(rest).toEqual([]);

    expect(ana).toMatchObject({
      name: "Ana María José-García",
      firstName: "Ana",
      middleName: "María",
      surname: "José-García",
      orcid: "0000-0002-1825-0097",
      contributorType: "author",
      corresponding: true,
    });
    expect(roles(ana)).toEqual(ANA_ROLES);

    expect(bob).toMatchObject({ name: "Bob White", contributorType: "author", corresponding: false });
    expect(bob?.orcid).toBeUndefined();
    expect(roles(bob)).toEqual([
      "Data curation:100",
      "Formal analysis:100",
      "Software:100",
      "Writing – review & editing:100",
    ]);

    expect(carol).toMatchObject({ name: "Carol Black", contributorType: "non-author" });
    expect(roles(carol)).toEqual(["Investigation:100"]);
  });

  it("matches headers by name in a reordered TSV with a Note column", () => {
    const [ana, ...rest] = fromTenzing(fixture("tenzing-reordered.tsv"));
    expect(rest).toEqual([]);
    expect(ana).toMatchObject({ name: "Ana María José-García", orcid: "0000-0002-1825-0097", corresponding: true });
    expect(roles(ana)).toEqual(ANA_ROLES);
  });
});

describe("isTenzing", () => {
  it("recognises both layouts", () => {
    expect(isTenzing(fixture("tenzing.csv"))).toBe(true);
    expect(isTenzing(fixture("tenzing-reordered.tsv"))).toBe(true);
  });

  it("recognises a header without the Author/Acknowledgee column by its roles", () => {
    const roleHeaders = "Conceptualization,Data curation,Formal analysis,Funding acquisition,Investigation";
    const more = "Methodology,Project administration,Resources,Software,Supervision";
    expect(isTenzing(`Firstname,Surname,${roleHeaders},${more}`)).toBe(true);
    expect(isTenzing(`Name,${roleHeaders},${more}`)).toBe(false);
    expect(isTenzing("Anne Namer, Bob Smith")).toBe(false);
  });
});
