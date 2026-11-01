import { describe, expect, it } from "vitest";
import codemeta from "../../codemeta.json";
import { citations } from "./citation";

const source = {
  name: "Example {Lab} Tool_kit",
  version: "1.2.3",
  datePublished: "2026-03-04",
  identifier: "https://doi.org/10.5555/example",
  url: "https://example.org",
  author: [
    { givenName: "Antonie", familyName: "van Leeuwenhoek" },
    { givenName: "Marie", familyName: "Skłodowska-Curie" },
    { givenName: "Youyou", familyName: "Tu" },
  ],
};

describe("citations", () => {
  it("writes an APA 7 software reference with every author", () => {
    expect(citations(source).apa).toBe(
      "van Leeuwenhoek, A., Skłodowska-Curie, M., & Tu, Y. (2026). Example {Lab} Tool_kit (Version 1.2.3) [Computer software]. https://doi.org/10.5555/example",
    );
  });

  it("escapes BibTeX specials and keeps the bare DOI", () => {
    const bib = citations(source).bibtex;
    expect(bib).toContain("title = {{Example \\{Lab\\} Tool\\_kit}},");
    expect(bib).toContain(
      "author = {{van Leeuwenhoek}, {Antonie} and {Skłodowska-Curie}, {Marie} and {Tu}, {Youyou}},",
    );
    expect(bib).toContain("doi = {10.5555/example},");
    expect(bib).toMatch(/^@misc\{credit-matrix,\n[\s\S]*\}\n$/);
  });

  it("writes CSL-JSON with the full release date", () => {
    const [item] = JSON.parse(citations(source).csl);
    expect(item).toMatchObject({ type: "software", DOI: "10.5555/example", issued: { "date-parts": [[2026, 3, 4]] } });
  });

  it("reads this project's codemeta.json", () => {
    expect(citations(codemeta).apa).toContain(`(Version ${codemeta.version})`);
  });
});
