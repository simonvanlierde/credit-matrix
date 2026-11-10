import { describe, expect, it } from "vitest";
import { toRoCrateFragment } from "../export/ro-crate";
import { createAuthor } from "../parse-authors";

describe("RO-Crate attribution fragment", () => {
  it("links people and CRediT roles without inventing package metadata", () => {
    const authors = [
      createAuthor("Josiah Carberry", {
        orcid: "0000-0002-1825-0097",
        contributions: [{ role: "Software", score: 33 }],
      }),
      createAuthor("Euclid", {
        contributorType: "non-author",
        contributions: [{ role: "Validation", score: 100 }],
      }),
      createAuthor("Unassigned Contributor"),
    ];
    const before = structuredClone(authors);
    const { metadata, warnings } = toRoCrateFragment(authors);
    expect(metadata["@context"]).toBe("https://w3id.org/ro/crate/1.2/context");
    expect(metadata["@graph"]).toEqual([
      {
        "@id": "./",
        author: [{ "@id": "https://orcid.org/0000-0002-1825-0097" }, { "@id": "#credit-matrix-role-1" }],
        contributor: [{ "@id": "#credit-matrix-person-2" }, { "@id": "#credit-matrix-role-2" }],
      },
      {
        "@id": "https://orcid.org/0000-0002-1825-0097",
        "@type": "Person",
        name: "Josiah Carberry",
        givenName: "Josiah",
        familyName: "Carberry",
      },
      {
        "@id": "#credit-matrix-role-1",
        "@type": "Role",
        author: { "@id": "https://orcid.org/0000-0002-1825-0097" },
        roleName: { "@id": "https://credit.niso.org/contributor-roles/software/" },
      },
      { "@id": "#credit-matrix-person-2", "@type": "Person", name: "Euclid" },
      {
        "@id": "#credit-matrix-role-2",
        "@type": "Role",
        contributor: { "@id": "#credit-matrix-person-2" },
        roleName: { "@id": "https://credit.niso.org/contributor-roles/validation/" },
      },
      { "@id": "https://credit.niso.org/contributor-roles/software/", "@type": "DefinedTerm", name: "Software" },
      { "@id": "https://credit.niso.org/contributor-roles/validation/", "@type": "DefinedTerm", name: "Validation" },
    ]);
    expect(warnings.join(" ")).toMatch(/Euclid has no ORCID/);
    expect(warnings.join(" ")).toMatch(/fragment.*not a standalone RO-Crate/);
    expect(warnings.join(" ")).toMatch(/omits scores/);
    expect(authors).toEqual(before);
    expect(toRoCrateFragment(authors)).toEqual({ metadata, warnings });
  });

  it("emits only the root links for an empty roster", () => {
    const { metadata, warnings } = toRoCrateFragment([]);
    expect(metadata["@graph"]).toEqual([{ "@id": "./", author: [], contributor: [] }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("not a standalone RO-Crate");
  });

  it("describes a repeated ORCID once while keeping both roles linked", () => {
    const first = createAuthor("Josiah Carberry", {
      orcid: "0000-0002-1825-0097",
      contributions: [{ role: "Software", score: 100 }],
    });
    const second = { ...first, contributions: [{ role: "Validation" as const, score: 100 }] };
    const third = createAuthor("Another Contributor", { contributions: [{ role: "Software", score: 100 }] });
    const graph = toRoCrateFragment([first, second, third]).metadata["@graph"];
    expect(graph[0]?.author).toEqual([
      { "@id": "https://orcid.org/0000-0002-1825-0097" },
      { "@id": "#credit-matrix-role-1" },
      { "@id": "#credit-matrix-role-2" },
      { "@id": "#credit-matrix-person-3" },
      { "@id": "#credit-matrix-role-3" },
    ]);
    expect(graph.filter((entry) => entry["@type"] === "Person")).toHaveLength(2);
    expect(new Set(graph.map((entry) => entry["@id"])).size).toBe(graph.length);
    expect(graph.filter((entry) => entry["@type"] === "Role")).toHaveLength(3);
  });
});
