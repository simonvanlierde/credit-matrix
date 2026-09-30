import { describe, expect, it } from "vitest";
import { AuthorSchema } from "../author";
import { loadUiCatalog, makeUiTranslator } from "../credit-i18n/ui-strings";
import { fromCsv, toCsv } from "../export/csv";
import { fromJson, toJson } from "../export/json";
import { toMarkdown } from "../export/markdown";
import { toJats4rXml } from "../export/xml";
import { fromJats4rXml } from "../export/xml-import";
import { generateStatement } from "../generate-statement";
import { createAuthor } from "../parse-authors";

/**
 * Equal contribution and corresponding authorship are not CRediT roles — the
 * taxonomy has no slot for either — but journals ask for them in the same
 * paragraph, so they ride alongside the contributions.
 */
function makeAuthors() {
  const jane = createAuthor("Jane A. Smith", {
    equalContribution: true,
    corresponding: true,
    contributions: [{ role: "Conceptualization", score: 100 }],
  });
  const bob = createAuthor("Bob White", {
    equalContribution: true,
    contributions: [{ role: "Investigation", score: 100 }],
  });
  const carol = createAuthor("Carol Davis", {
    contributions: [{ role: "Software", score: 100 }],
  });
  return [jane, bob, carol];
}

describe("marker data model", () => {
  it("defaults both markers to false", () => {
    const author = createAuthor("Jane A. Smith");
    expect(author.equalContribution).toBe(false);
    expect(author.corresponding).toBe(false);
  });

  it("accepts an older payload that predates the markers", () => {
    const parsed = AuthorSchema.parse({
      id: "abc",
      name: "Jane A. Smith",
      firstName: "Jane",
      middleName: "A.",
      surname: "Smith",
      initials: "JAS",
      contributions: [],
    });
    expect(parsed.equalContribution).toBe(false);
    expect(parsed.corresponding).toBe(false);
  });

  it("round-trips through JSON", () => {
    const restored = fromJson(toJson(makeAuthors()));
    expect(restored[0]?.equalContribution).toBe(true);
    expect(restored[0]?.corresponding).toBe(true);
    expect(restored[2]?.equalContribution).toBe(false);
  });
});

describe("markers in the statement", () => {
  it("adds one note per marker, naming the people rather than repeating symbols", () => {
    const statement = generateStatement(makeAuthors(), { format: "by-role" });
    expect(statement).toContain("Jane A. Smith and Bob White contributed equally to this work.");
    expect(statement).toContain("Correspondence: Jane A. Smith.");
  });

  it("uses initials in the short formats, matching the statement body", () => {
    const statement = generateStatement(makeAuthors(), { format: "by-role-short" });
    expect(statement).toContain("JAS and BW contributed equally to this work.");
  });

  it("says nothing when nobody is marked", () => {
    const statement = generateStatement(
      [createAuthor("Jane A. Smith", { contributions: [{ role: "Software", score: 100 }] })],
      {
        format: "by-role",
      },
    );
    expect(statement).not.toContain("contributed equally");
    expect(statement).not.toContain("Correspondence");
  });

  it("lists three or more equal contributors with commas", () => {
    const authors = ["A One", "B Two", "C Three"].map((name) =>
      createAuthor(name, { equalContribution: true, contributions: [{ role: "Software", score: 100 }] }),
    );
    expect(generateStatement(authors, { format: "by-role" })).toContain(
      "A One, B Two, and C Three contributed equally to this work.",
    );
  });

  it("carries the notes into the HTML flavour", () => {
    const html = generateStatement(makeAuthors(), { format: "by-role", asHtml: true });
    expect(html).toContain("<p>Jane A. Smith and Bob White contributed equally to this work.</p>");
  });

  it("uses the output locale's word order and punctuation", async () => {
    const translateUi = makeUiTranslator(await loadUiCatalog("ja"));
    const statement = generateStatement(makeAuthors(), { format: "by-role", translateUi, locale: "ja" });
    // CLDR joins a Japanese list with "、", not "と".
    expect(statement).toContain("Jane A. Smith、Bob Whiteは本研究に同等に貢献しました。");
    expect(statement).toContain("責任著者：Jane A. Smith。");
  });
});

describe("markers in exports", () => {
  it("round-trips through CSV", () => {
    const csv = toCsv(makeAuthors());
    expect(csv.split("\n")[0]).toContain("Equal contribution");
    expect(csv.split("\n")[0]).toContain("Corresponding");

    const restored = fromCsv(csv);
    expect(restored[0]?.equalContribution).toBe(true);
    expect(restored[0]?.corresponding).toBe(true);
    expect(restored[1]?.corresponding).toBe(false);
  });

  it("reads a CSV written before the marker columns existed", () => {
    const legacy = "Name,ORCID,Type,Conceptualization\nJane A. Smith,,author,100";
    const restored = fromCsv(legacy);
    expect(restored[0]?.equalContribution).toBe(false);
  });

  it("notes the markers under the Markdown table", () => {
    const markdown = toMarkdown(makeAuthors());
    expect(markdown).toContain("Jane A. Smith and Bob White contributed equally to this work.");
    expect(markdown).toContain("Correspondence: Jane A. Smith.");
  });

  it("round-trips through JATS4R as contrib attributes", () => {
    const xml = toJats4rXml(makeAuthors());
    // JATS has its own slots for both, outside the CRediT vocabulary.
    expect(xml).toContain('<contrib contrib-type="author" equal-contrib="yes" corresp="yes">');
    expect(xml).toContain('<contrib contrib-type="author" equal-contrib="yes">');

    const restored = fromJats4rXml(xml);
    expect(restored[0]?.equalContribution).toBe(true);
    expect(restored[0]?.corresponding).toBe(true);
    expect(restored[2]?.equalContribution).toBe(false);
  });
});

describe("replacement-pattern safety", () => {
  it("keeps a name containing $-patterns literal in the notes", () => {
    // String.replace expands "$&" and "$'" in a replacement *string*; a
    // contributor named with one must still appear verbatim.
    // Active contributions, because notes are suppressed on an empty statement.
    const authors = [
      createAuthor("A $& Consortium", {
        equalContribution: true,
        corresponding: true,
        contributions: [{ role: "Conceptualization", score: 100 }],
      }),
      createAuthor("Bob White", {
        equalContribution: true,
        contributions: [{ role: "Investigation", score: 100 }],
      }),
    ];
    const statement = generateStatement(authors, { format: "by-author" });
    expect(statement).toContain("A $& Consortium and Bob White contributed equally");
    expect(statement).toContain("Correspondence: A $& Consortium.");
    expect(statement).not.toContain("{names}");
  });
});
