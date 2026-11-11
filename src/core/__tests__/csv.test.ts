import { describe, expect, it } from "vitest";
import { delimiterOf, escapeCsvFormulaOnly, fromCsv, headerCells, parseCsvRecords, toCsv } from "../export/csv";
import { parseAuthorText } from "../parse-authors";

describe("CSV import/export", () => {
  it("round-trips authors and contribution scores", () => {
    const authors = parseAuthorText("Grace Hopper\nCharles Darwin");
    const [grace, charles] = authors;
    if (!(grace && charles)) throw new Error("expected 2 authors");

    const graceConceptualization = grace.contributions[0];
    const charlesInvestigation = charles.contributions[4];
    if (!(graceConceptualization && charlesInvestigation)) throw new Error("expected contributions");

    grace.orcid = "0000-0000-0000-0001";
    graceConceptualization.score = 100;
    charlesInvestigation.score = 66;

    const parsed = fromCsv(toCsv(authors));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.name).toBe("Grace Hopper");
    expect(parsed[0]?.orcid).toBe("0000-0000-0000-0001");
    expect(parsed[0]?.contributions[0]?.score).toBe(100);
    expect(parsed[1]?.contributions[4]?.score).toBe(66);
  });

  it("round-trips the author / non-author contributor type", () => {
    const [grace, charles] = parseAuthorText("Grace Hopper\nCharles Darwin");
    if (!(grace && charles)) throw new Error("expected 2 authors");
    charles.contributorType = "non-author";

    const parsed = fromCsv(toCsv([grace, charles]));
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
    // quote-aware record parser on import (a naive line-split would tear it);
    // createAuthor then reads the line break as a space.
    const [author] = parseAuthorText("Grace Hopper");
    if (!author) throw new Error("expected author");
    author.name = "Grace\nHopper";

    const parsed = fromCsv(toCsv([author]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("Grace Hopper");
  });

  it("round-trips a field containing a bare carriage return", () => {
    // The record parser ends a row on a lone \r too, so the field must be quoted.
    const [author] = parseAuthorText("Grace Hopper");
    if (!author) throw new Error("expected author");
    author.name = "Ann\r=HYPERLINK()";

    const parsed = fromCsv(toCsv([author]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("Ann =HYPERLINK()");
  });

  it("keeps a leading apostrophe behind leading whitespace", () => {
    // Import trims a cell before it strips the formula guard, so export must decide on the trimmed value too.
    const [author] = parseAuthorText("Grace Hopper");
    if (!author) throw new Error("expected author");
    author.name = "\n'-Katherine Johnson";

    const parsed = fromCsv(toCsv([author]));
    expect(parsed[0]?.name).toBe("'-Katherine Johnson");
  });

  it("reads a CSV that starts with a UTF-8 byte order mark", () => {
    // Downloads start with a BOM so Excel reads non-ASCII names as UTF-8.
    const [author] = parseAuthorText("José García");
    if (!author) throw new Error("expected author");

    const parsed = fromCsv(`﻿${toCsv([author])}`);
    expect(parsed.map((a) => a.name)).toEqual(["José García"]);
  });

  it("parses escaped quotes and commas inside a quoted field", () => {
    // RFC-4180: `""` is a literal quote and a comma inside quotes is data, not a
    // column break. The score column must still land at 100.
    const parsed = fromCsv(`Name,Conceptualization\n"Grace ""GH"", Hopper",100`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe('Grace "GH", Hopper'); // field reassembled verbatim, comma not treated as a column break
    expect(parsed[0]?.contributions[0]?.score).toBe(100);
  });

  it("reads a quote inside an unquoted field as a literal character", () => {
    const parsed = fromCsv(`Name,Conceptualization\nAnn O"Brien,100\nCharles Lee,100`);
    expect(parsed.map((a) => a.name)).toEqual(['Ann O"Brien', "Charles Lee"]);
    expect(parsed[0]?.contributions[0]?.score).toBe(100);
  });

  it("reads a quoted field that follows a space after the comma", () => {
    const [grace] = fromCsv(`Name,Software\n "Hopper, Grace", "Lead"`);
    expect(grace?.name).toBe("Hopper, Grace");
    expect(grace?.contributions.find((c) => c.role === "Software")?.score).toBe(100);
  });

  it("matches headers and level words whatever their case or dash", () => {
    const csv = `name,type,conceptualization,Writing - original draft,SOFTWARE\nGrace Hopper,Non-author,Lead,supporting,50`;
    const [grace] = fromCsv(csv);
    expect(grace?.contributorType).toBe("non-author");
    const score = (role: string) => grace?.contributions.find((c) => c.role === role)?.score;
    expect(score("Conceptualization")).toBe(100);
    expect(score("Writing – original draft")).toBe(33);
    expect(score("Software")).toBe(50);
  });

  it("skips a row with no usable name and keeps the rest", () => {
    const parsed = fromCsv(`Name,Conceptualization\nGrace Hopper,100\n,100\n123,100\nCharles Lee,100`);
    expect(parsed.map((a) => a.name)).toEqual(["Grace Hopper", "Charles Lee"]);
  });

  it("rounds a fractional score cell to an integer", () => {
    const csv = `Name,Conceptualization\nGrace Hopper,50.5`;
    const parsed = fromCsv(csv);
    expect(parsed[0]?.contributions[0]?.score).toBe(51);
  });

  it("writes the markers as yes and no, and an empty cell for a missing ORCID", () => {
    const [grace, charles] = parseAuthorText("Grace Hopper\nCharles Darwin");
    if (!(grace && charles)) throw new Error("expected 2 authors");
    grace.equalContribution = true;
    grace.corresponding = true;

    const [, graceRow, charlesRow] = toCsv([grace, charles]).split("\n");
    expect(graceRow?.startsWith("Grace Hopper,,author,yes,yes,")).toBe(true);
    expect(charlesRow?.startsWith("Charles Darwin,,author,no,no,")).toBe(true);
    expect(fromCsv(toCsv([grace, charles])).map((a) => [a.equalContribution, a.corresponding])).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it("keeps a leading apostrophe that does not guard a formula", () => {
    const [author] = parseAuthorText("Grace Hopper");
    if (!author) throw new Error("expected author");
    author.name = "'t Hooft";

    expect(fromCsv(toCsv([author]))[0]?.name).toBe("'t Hooft");
    expect(fromCsv("Name\n't Hooft")[0]?.name).toBe("'t Hooft");
  });

  it("strips the formula guard behind the spaces a spreadsheet may add", () => {
    expect(fromCsv("Name\n  '=Grace Hopper")[0]?.name).toBe("=Grace Hopper");
  });

  it("guards only a formula character at the start of a cell", () => {
    const [author] = parseAuthorText("Anne-Marie Lee");
    if (!author) throw new Error("expected author");
    expect(toCsv([author]).split("\n")[1]?.startsWith("Anne-Marie Lee,")).toBe(true);
  });

  it("reads the header cells of a sheet with a byte order mark", () => {
    expect(headerCells("\uFEFFName,ORCID\nGrace Hopper,")).toEqual(["name", "orcid"]);
  });

  it("keeps a blank line as an empty record", () => {
    expect(parseCsvRecords("a\n\nb")).toEqual([["a"], [""], ["b"]]);
  });

  it("ends a record on CRLF, LF or a bare CR, without an empty record between", () => {
    expect(parseCsvRecords("a,b\r\nc,d\ne,f\rg,h")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("skips blank lines, also before the header", () => {
    expect(fromCsv("\n,\nName\nGrace Hopper\n\nCharles Darwin").map((a) => a.name)).toEqual([
      "Grace Hopper",
      "Charles Darwin",
    ]);
  });

  it("picks the delimiter from the first line only, and comma or semicolon on a tie", () => {
    expect(delimiterOf("Name,ORCID\nGrace;Hopper;x;y")).toBe(",");
    expect(delimiterOf("Name,ORCID\r\nGrace;Hopper;x;y")).toBe(",");
    expect(delimiterOf("Name;ORCID\tType")).toBe(";");
    expect(delimiterOf("Name")).toBe(",");
  });

  it("reads empty text as nobody, without asking for a Name column", () => {
    expect(fromCsv("")).toEqual([]);
    expect(fromCsv("\n,,\n")).toEqual([]);
  });

  it("skips a row too short to reach the Name column", () => {
    expect(fromCsv("ORCID,Name\n0000-0002-1825-0097\n,Grace Hopper").map((a) => a.name)).toEqual(["Grace Hopper"]);
  });

  it("guards a formula after leading spaces, as import trims the cell before reading it", () => {
    expect(escapeCsvFormulaOnly("  =SUM(A1) ")).toBe("'=SUM(A1)");
    expect(escapeCsvFormulaOnly(" 't Hooft")).toBe("'t Hooft");
  });

  it("drops an ORCID that is not valid and keeps the contributor", () => {
    const parsed = fromCsv("Name,ORCID\nGrace Hopper,0000-0000-0000-0000");
    expect(parsed.map((a) => [a.name, a.orcid])).toEqual([["Grace Hopper", undefined]]);
  });
});
