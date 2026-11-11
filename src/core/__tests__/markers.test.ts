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
  const grace = createAuthor("Grace B. Hopper", {
    equalContribution: true,
    corresponding: true,
    contributions: [{ role: "Conceptualization", score: 100 }],
  });
  const charles = createAuthor("Charles Darwin", {
    equalContribution: true,
    contributions: [{ role: "Investigation", score: 100 }],
  });
  const katherine = createAuthor("Katherine Johnson", {
    contributions: [{ role: "Software", score: 100 }],
  });
  return [grace, charles, katherine];
}

describe("marker data model", () => {
  it("defaults both markers to false", () => {
    const author = createAuthor("Grace B. Hopper");
    expect(author.equalContribution).toBe(false);
    expect(author.corresponding).toBe(false);
  });

  it("accepts an older payload that predates the markers", () => {
    const parsed = AuthorSchema.parse({
      id: "abc",
      name: "Grace B. Hopper",
      firstName: "Grace",
      middleName: "A.",
      surname: "Hopper",
      initials: "GBH",
      contributions: [],
    });
    expect(parsed.equalContribution).toBe(false);
    expect(parsed.corresponding).toBe(false);
  });

  it("round-trips through JSON", () => {
    const restored = fromJson(toJson(makeAuthors())).authors;
    expect(restored[0]?.equalContribution).toBe(true);
    expect(restored[0]?.corresponding).toBe(true);
    expect(restored[2]?.equalContribution).toBe(false);
  });
});

describe("markers in the statement", () => {
  it("adds one note per marker, naming the people rather than repeating symbols", () => {
    const statement = generateStatement(makeAuthors(), { format: "by-role" });
    expect(statement).toContain("Grace B. Hopper and Charles Darwin contributed equally to this work.");
    expect(statement).toContain("Correspondence: Grace B. Hopper.");
  });

  it("uses initials in the short formats, matching the statement body", () => {
    const statement = generateStatement(makeAuthors(), { format: "by-role-short" });
    expect(statement).toContain("GBH and CD contributed equally to this work.");
  });

  it("says nothing when nobody is marked", () => {
    const statement = generateStatement(
      [createAuthor("Grace B. Hopper", { contributions: [{ role: "Software", score: 100 }] })],
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

  it("keeps the notes in the HTML flavour", () => {
    const html = generateStatement(makeAuthors(), { format: "by-role", asHtml: true });
    expect(html).toContain("<p>Grace B. Hopper and Charles Darwin contributed equally to this work.</p>");
  });

  it("uses the output locale's word order and punctuation", async () => {
    const translateUi = makeUiTranslator(await loadUiCatalog("ja"));
    const statement = generateStatement(makeAuthors(), { format: "by-role", translateUi, locale: "ja" });
    // CLDR joins a Japanese list with "、", not "と".
    expect(statement).toContain("Grace B. Hopper、Charles Darwinは本研究に同等に貢献しました。");
    expect(statement).toContain("責任著者：Grace B. Hopper。");
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
    const legacy = "Name,ORCID,Type,Conceptualization\nGrace B. Hopper,,author,100";
    const restored = fromCsv(legacy);
    expect(restored[0]?.equalContribution).toBe(false);
  });

  it("notes the markers under the Markdown table", () => {
    const markdown = toMarkdown(makeAuthors());
    expect(markdown).toContain("Grace B. Hopper and Charles Darwin contributed equally to this work.");
    expect(markdown).toContain("Correspondence: Grace B. Hopper.");
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
      createAuthor("Charles Darwin", {
        equalContribution: true,
        contributions: [{ role: "Investigation", score: 100 }],
      }),
    ];
    const statement = generateStatement(authors, { format: "by-author" });
    expect(statement).toContain("A $& Consortium and Charles Darwin contributed equally");
    expect(statement).toContain("Correspondence: A $& Consortium.");
    expect(statement).not.toContain("{names}");
  });
});
