import { describe, expect, it } from "vitest";
import { fromCsv, toCsv } from "../export/csv";
import { parseAuthorText } from "../parse-authors";

describe("CSV import/export", () => {
  it("round-trips authors and contribution scores", () => {
    const authors = parseAuthorText("Jane Smith\nBob White");
    const [jane, bob] = authors;
    if (!(jane && bob)) throw new Error("expected 2 authors");

    const janeConceptualization = jane.contributions[0];
    const bobInvestigation = bob.contributions[4];
    if (!(janeConceptualization && bobInvestigation)) throw new Error("expected contributions");

    jane.orcid = "0000-0000-0000-0001";
    janeConceptualization.score = 100;
    bobInvestigation.score = 66;

    const parsed = fromCsv(toCsv(authors));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.name).toBe("Jane Smith");
    expect(parsed[0]?.orcid).toBe("0000-0000-0000-0001");
    expect(parsed[0]?.contributions[0]?.score).toBe(100);
    expect(parsed[1]?.contributions[4]?.score).toBe(66);
  });

  it("round-trips the author / non-author contributor type", () => {
    const [jane, bob] = parseAuthorText("Jane Smith\nBob White");
    if (!(jane && bob)) throw new Error("expected 2 authors");
    bob.contributorType = "non-author";

    const parsed = fromCsv(toCsv([jane, bob]));
    expect(parsed[0]?.contributorType).toBe("author");
    expect(parsed[1]?.contributorType).toBe("non-author");
  });

  it('requires a "Name" column', () => {
    expect(() => fromCsv("ORCID\n0000-0000-0000-0001")).toThrow('CSV must include a "Name" column.');
  });

  it("guards formula-injection cells on export and unescapes them on import", () => {
    const authors = parseAuthorText("=HYPERLINK Evil\n@SUM Attack");
    const csv = toCsv(authors);

    // The exported name cells must be neutralised with a leading apostrophe.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@SUM");

    // Re-importing strips the guard, restoring the original display name.
    const parsed = fromCsv(csv);
    expect(parsed[0]?.name).toBe("=HYPERLINK Evil");
    expect(parsed[1]?.name).toBe("@SUM Attack");
  });

  it("round-trips a quoted field containing a newline", () => {
    // A name with an embedded newline must survive quoting on export and the
    // quote-aware record parser on import (a naive line-split would tear it).
    const [author] = parseAuthorText("Jane Smith");
    if (!author) throw new Error("expected author");
    author.name = "Jane\nSmith";

    const parsed = fromCsv(toCsv([author]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("Jane\nSmith");
  });

  it("round-trips a field containing a bare carriage return", () => {
    // The record parser ends a row on a lone \r too, so the field must be quoted.
    const [author] = parseAuthorText("Jane Smith");
    if (!author) throw new Error("expected author");
    author.name = "Ann\r=HYPERLINK()";

    const parsed = fromCsv(toCsv([author]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("Ann\r=HYPERLINK()");
  });

  it("reads a CSV that starts with a UTF-8 byte order mark", () => {
    // Downloads carry a BOM so Excel reads non-ASCII names as UTF-8.
    const [author] = parseAuthorText("José García");
    if (!author) throw new Error("expected author");

    const parsed = fromCsv(`﻿${toCsv([author])}`);
    expect(parsed.map((a) => a.name)).toEqual(["José García"]);
  });

  it("parses escaped quotes and commas inside a quoted field", () => {
    // RFC-4180: `""` is a literal quote and a comma inside quotes is data, not a
    // column break. The score column must still land at 100.
    const parsed = fromCsv(`Name,Conceptualization\n"Jane ""JS"", Smith",100`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe('Jane "JS", Smith'); // field reassembled verbatim, comma not treated as a column break
    expect(parsed[0]?.contributions[0]?.score).toBe(100);
  });

  it("rounds a fractional score cell to an integer", () => {
    const csv = `Name,Conceptualization\nJane Smith,50.5`;
    const parsed = fromCsv(csv);
    expect(parsed[0]?.contributions[0]?.score).toBe(51);
  });
});
