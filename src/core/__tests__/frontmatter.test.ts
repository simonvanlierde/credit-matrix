import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createAuthor, toMyst, toQuarto } from "../index";

const authors = [
  createAuthor('Lin: "River" #1', {
    orcid: "0000-0002-1825-0097",
    contributions: [
      { role: "Software", score: 33 },
      { role: "Conceptualization", score: 100 },
      { role: "Formal analysis", score: 66 },
    ],
  }),
  createAuthor("No roles yet"),
  createAuthor("Acknowledged helper", { contributorType: "non-author" }),
];

describe("manuscript front matter", () => {
  it("writes Quarto author metadata with levels and safely quoted names", () => {
    expect(parse(toQuarto(authors))).toEqual({
      author: [
        {
          name: 'Lin: "River" #1',
          orcid: "0000-0002-1825-0097",
          roles: [{ Conceptualization: "lead" }, { "Formal analysis": "equal" }, { Software: "supporting" }],
        },
        { name: "No roles yet", roles: [] },
      ],
    });
    expect(parse(toQuarto(authors, { yesNo: true })).author[0].roles).toEqual([
      "Conceptualization",
      "Formal analysis",
      "Software",
    ]);
  });

  it("writes MyST authors with canonical role names and an explicit loss note", () => {
    const yaml = toMyst(authors);
    expect(parse(yaml)).toEqual({
      authors: [
        {
          name: 'Lin: "River" #1',
          orcid: "0000-0002-1825-0097",
          roles: ["Conceptualization", "Formal analysis", "Software"],
        },
        { name: "No roles yet", roles: [] },
      ],
    });
    expect(yaml).toContain("MyST omits contribution levels");
  });

  it.each([toQuarto, toMyst])("keeps empty rosters as lists and explains omitted metadata", (exportYaml) => {
    expect(Object.values(parse(exportYaml([])))).toEqual([[]]);
    expect(exportYaml(authors)).toContain("Non-author contributors are left out");
    expect(exportYaml(authors)).toContain("Keep native JSON for scores, author markers and replies");
  });

  it.each([toQuarto, toMyst])("keeps Unicode and YAML control characters as data", (exportYaml) => {
    const name = "Éva\tO'Neil: [roles] & 李";
    const [people] = Object.values(parse(exportYaml([createAuthor(name)]))) as { name: string }[][];
    expect(people?.[0]?.name).toBe(createAuthor(name).name);
  });
});
