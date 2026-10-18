import { describe, expect, it } from "vitest";
import { MAX_AUTHORS } from "../author";
import { toCsv } from "../export/csv";
import { toJson } from "../export/json";
import { toJats4rXml } from "../export/xml";
import { detectFormat, importAny } from "../import";
import { createAuthor, normalizeRoster } from "../parse-authors";
import { encodeShareHash } from "../share-link";
import { fromSharePayload } from "../share-payload";

const roster = () => [
  createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] }),
  createAuthor("Bob White", { contributions: [{ role: "Investigation", score: 66 }] }),
];

describe("detectFormat", () => {
  it("reads a comma list of names containing 'name' as names, not CSV", () => {
    expect(detectFormat("Anne Namer, Bob Smith")).toBe("names");
  });

  it("reads text with CRediT's own wording as a statement, and importAny refuses it", async () => {
    const text = "MG: Writing, conceptualization. EM and FG: software.";
    expect(detectFormat(text)).toBe("statement");
    // "Software" alone also turns up in name lists and ICMJE prose.
    expect(detectFormat("Software Smith, Jane Doe")).toBe("names");
    await expect(importAny(text)).rejects.toThrow(/parseStatement/);
  });

  it("reads text with a Name header cell as CSV", () => {
    expect(detectFormat("Name,ORCID\nJane Smith,")).toBe("csv");
    expect(detectFormat('"name" , Conceptualization\nJane Smith,100')).toBe("csv");
    expect(detectFormat("﻿Name,Conceptualization\nJane Smith,100")).toBe("csv");
  });

  it("reads a tenzing header as tenzing, whatever the separator", () => {
    expect(detectFormat("Author/Acknowledgee,Firstname,Surname\nAuthor,Jane,Smith")).toBe("tenzing");
    expect(detectFormat("Author/Acknowledgee;Firstname;Surname\nAuthor;Jane;Smith")).toBe("tenzing");
  });

  it("reads a tab- or semicolon-separated sheet with a Name header as CSV", () => {
    expect(detectFormat("Name\tSoftware\nJane Smith\t100")).toBe("csv");
    expect(detectFormat("Name;Software\nJane Smith;100")).toBe("csv");
  });

  it("tells JSON, XML, links and nothing apart", () => {
    expect(detectFormat('{"version":1}')).toBe("json");
    expect(detectFormat("[not json, Name")).toBe("csv");
    expect(detectFormat("  <article/>")).toBe("xml");
    expect(detectFormat("https://credit.duinlab.nl/#s=abc")).toBe("link");
    expect(detectFormat(" #s=jc67_-Ab \n")).toBe("link");
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
    ["tenzing", "Author/Acknowledgee,Firstname,Surname\nAuthor,Jane,Smith\nAuthor,Bob,White"],
  ])("reads %s", async (format, text) => {
    const imported = await importAny(text);
    expect(imported.format).toBe(format);
    expect(names(imported.authors)).toEqual(["Jane Smith", "Bob White"]);
  });

  it("reads a bare share hash", async () => {
    const imported = await importAny(await encodeShareHash({ authors: roster() }));
    expect(imported.format).toBe("link");
    expect(names(imported.authors)).toEqual(["Jane Smith", "Bob White"]);
  });

  it("reads a semicolon CSV", async () => {
    const imported = await importAny("Name;Software\nJane Smith;100\nBob White;66");
    expect(imported.format).toBe("csv");
    expect(imported.authors[1]?.contributions.find((c) => c.role === "Software")?.score).toBe(66);
  });

  it("gives the same contributor for decomposed and precomposed names", async () => {
    const nfd = await importAny("José Gálvez");
    const nfc = await importAny("José Gálvez");
    const strip = ({ id: _, ...rest }: { id: string }) => rest;
    expect(nfd.authors.map(strip)).toEqual(nfc.authors.map(strip));
    expect(nfd.authors[0]?.name).toBe("José Gálvez");
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

  it.each(["constructor", "toString", "__proto__"])("replaces the id %s, which plain objects already hold", (id) => {
    const [jane] = roster();
    if (!jane) throw new Error("expected an author");
    expect(normalizeRoster([{ ...jane, id }])[0]?.id).not.toBe(id);
    expect(() => fromSharePayload(JSON.stringify({ v: 2, a: [{ i: id, n: "Jane Smith", s: [] }] }))).toThrow();
  });

  it("deduplicates initials and keeps a structured particle surname", () => {
    const anne = createAuthor("Anne van der Berg", { firstName: "Anne", middleName: "", surname: "van der Berg" });
    const result = normalizeRoster([anne, createAuthor("Anna Vogel")]);
    expect(result[0]?.surname).toBe("van der Berg");
    expect(new Set(result.map((a) => a.initials)).size).toBe(2);
  });

  it.each([
    ["empty", { firstName: "", middleName: "", surname: "" }],
    ["stale", { firstName: "Jan", middleName: "", surname: "Smit" }],
    ["partial-word", { firstName: "Ja", middleName: "", surname: "th" }],
  ])("re-parses %s name parts instead of keeping them", (_, parts) => {
    const [jane] = roster();
    if (!jane) throw new Error("expected an author");
    expect(normalizeRoster([{ ...jane, ...parts }])[0]).toMatchObject({
      firstName: "Jane",
      surname: "Smith",
      initials: "JS",
    });
  });

  it("returns an unchanged row as the same object", () => {
    const [jane, bob] = normalizeRoster(roster());
    if (!(jane && bob)) throw new Error("expected two authors");
    const [sameJane, renamedBob] = normalizeRoster([jane, { ...bob, name: "Bob Black" }]);
    expect(sameJane).toBe(jane);
    expect(renamedBob).toMatchObject({ name: "Bob Black", surname: "Black" });
  });

  it("refuses more than MAX_AUTHORS rows", () => {
    const many = Array.from({ length: MAX_AUTHORS + 1 }, (_, i) => createAuthor(`Person ${i} Name`));
    expect(() => normalizeRoster(many)).toThrow(/at most/);
  });
});
