import { describe, expect, it } from "vitest";
import codemeta from "../../codemeta.json";
import packageJson from "../../package.json";
import { authors, homeDescription, webApplicationJsonLd } from "./json-ld";

describe("structured data", () => {
  it("joins the authors to the owner's node and keeps the ORCID iD as sameAs", () => {
    expect(authors).toEqual([
      expect.objectContaining({
        "@id": "https://simonvanlierde.com/#person",
        sameAs: "https://orcid.org/0009-0006-6953-909X",
      }),
    ]);
  });

  it("shares one Person @id, so codemeta.json has one author until each gets its own id", () => {
    expect(
      codemeta.author.length,
      "every author gets the same @id in src/lib/json-ld.ts: give each author a per-author id first",
    ).toBe(1);
  });

  it("uses the meta description and the package version for the web application", () => {
    expect(webApplicationJsonLd.description).toBe(homeDescription);
    expect(homeDescription.length).toBeLessThanOrEqual(155);
    expect(webApplicationJsonLd.softwareVersion).toBe(packageJson.version);
  });
});
