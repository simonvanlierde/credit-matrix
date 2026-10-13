import { describe, expect, it } from "vitest";
import { MAX_AUTHORS } from "../author";
import { toCsv } from "../export/csv";
import { toJson } from "../export/json";
import { toJats4rXml } from "../export/xml";
import { detectFormat, importAny } from "../import";
import { createAuthor, normalizeRoster } from "../parse-authors";
import { encodeShareHash } from "../share-link";

const roster = () => [
  createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] }),
  createAuthor("Bob White", { contributions: [{ role: "Investigation", score: 66 }] }),
];

describe("detectFormat", () => {
  it("reads a comma list of names containing 'name' as names, not CSV", () => {
    expect(detectFormat("Anne Namer, Bob Smith")).toBe("names");
  });

  it("reads text with a Name header cell as CSV", () => {
    expect(detectFormat("Name,ORCID\nJane Smith,")).toBe("csv");
    expect(detectFormat('"name" , Conceptualization\nJane Smith,100')).toBe("csv");
    expect(detectFormat("﻿Name,Conceptualization\nJane Smith,100")).toBe("csv");
  });

  it("reads a tenzing header as tenzing", () => {
    expect(detectFormat("Author/Acknowledgee,Firstname,Surname\nAuthor,Jane,Smith")).toBe("tenzing");
  });

  it("tells JSON, XML, links and nothing apart", () => {
    expect(detectFormat('{"version":1}')).toBe("json");
    expect(detectFormat("[not json, Name")).toBe("csv");
    expect(detectFormat("  <article/>")).toBe("xml");
    expect(detectFormat("https://credit.duinlab.nl/#s=abc")).toBe("link");
    expect(detectFormat(" \n ")).toBe("unknown");
  });
});

describe("importAny", () => {
  const names = (authors: { name: string }[]) => authors.map((a) => a.name);

  it.each([
    ["json", toJson(roster())],
    ["csv", toCsv(roster())],
    ["xml", toJats4rXml(roster())],
    ["names", "Jane Smith\nBob White"],
  ])("reads %s", async (format, text) => {
    const imported = await importAny(text);
    expect(imported.format).toBe(format);
    expect(names(imported.authors)).toEqual(["Jane Smith", "Bob White"]);
  });

  it("reads a share link with its title", async () => {
    const link = await encodeShareHash({ authors: roster(), title: "Eel cognition" }, "https://example.org/");
    const imported = await importAny(link);
    expect(imported).toMatchObject({ format: "link", title: "Eel cognition" });
    expect(names(imported.authors)).toEqual(["Jane Smith", "Bob White"]);
  });

  it("throws on a broken link and on empty text", async () => {
    await expect(importAny("https://example.org/#s=nope")).rejects.toThrow(/share link/);
    await expect(importAny("  ")).rejects.toThrow(/Nothing to import/);
  });
});

describe("normalizeRoster", () => {
  it("gives duplicate and unshareable ids fresh ones and keeps the rest", () => {
    const [jane, bob] = roster();
    if (!(jane && bob)) throw new Error("expected two authors");
    const result = normalizeRoster([jane, { ...bob, id: jane.id }, { ...bob, id: "has spaces" }]);
    expect(result[0]?.id).toBe(jane.id);
    expect(new Set(result.map((a) => a.id)).size).toBe(3);
    expect(result.every((a) => /^[\w-]{1,64}$/.test(a.id))).toBe(true);
  });

  it("deduplicates initials and keeps a structured particle surname", () => {
    const anne = createAuthor("Anne van der Berg", { firstName: "Anne", middleName: "", surname: "van der Berg" });
    const result = normalizeRoster([anne, createAuthor("Anna Vogel")]);
    expect(result[0]?.surname).toBe("van der Berg");
    expect(new Set(result.map((a) => a.initials)).size).toBe(2);
  });

  it("refuses more than MAX_AUTHORS rows", () => {
    const many = Array.from({ length: MAX_AUTHORS + 1 }, (_, i) => createAuthor(`Person ${i} Name`));
    expect(() => normalizeRoster(many)).toThrow(/at most/);
  });
});
