// biome-ignore lint/correctness/noNodejsModules: fixture files are read only by tests.
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { MAX_AUTHORS, MAX_IMPORT_BYTES } from "../author";
import { toCodemeta } from "../export/codemeta";
import { toCrossrefContributors } from "../export/crossref";
import { toCsv } from "../export/csv";
import { toJson } from "../export/json";
import { toTenzing } from "../export/tenzing";
import { toJats4rXml } from "../export/xml";
import { detectFormat, importAny } from "../import";
import { createAuthor } from "../parse-authors";

const people = [
  {
    "@type": "Person",
    givenName: "Antonie",
    familyName: "van Leeuwenhoek",
    "@id": "https://orcid.org/0000-0002-1825-0097",
  },
  { type: "Organization", name: "The Research Team", id: "https://orcid.org/0000-0002-1825-0097" },
  { type: "Role", "schema:author": "#one", roleName: "https://credit.niso.org/contributor-roles/software/" },
];
const codemeta = JSON.stringify({ "@context": "https://w3id.org/codemeta/3.0", author: people });

it("reads CodeMeta people and organisations with no inferred roles", async () => {
  expect(detectFormat(codemeta)).toBe("codemeta");
  const { authors } = await importAny(codemeta);
  expect(authors.map(({ name, orcid }) => ({ name, orcid }))).toEqual([
    { name: "Antonie van Leeuwenhoek", orcid: "0000-0002-1825-0097" },
    { name: "The Research Team", orcid: undefined },
  ]);
  expect(authors.every((author) => author.contributions.every((c) => c.score === 0))).toBe(true);
});

it.each([
  ["cff", "cff-version: 1.2.0\ntitle: Example\nauthors:\n  - family-names: van Leeuwenhoek\n    given-names: Antonie"],
  ["zenodo", JSON.stringify({ title: "Example", creators: [{ name: "van Leeuwenhoek, Antonie" }] })],
] as const)("routes %s through citesync and reads the same CodeMeta authors", async (format, text) => {
  expect(detectFormat(text)).toBe(format);
  const convertCitation = vi.fn(async () => codemeta);
  const result = await importAny(text, { convertCitation });
  expect(convertCitation).toHaveBeenCalledWith(text, format);
  expect(result.authors.map((author) => author.name)).toEqual(["Antonie van Leeuwenhoek", "The Research Team"]);
  await expect(importAny(text)).rejects.toThrow(/web app/);
});

it("handles singleton, missing and malformed CodeMeta author entries without reading linked Role entries", async () => {
  const read = (author: unknown) => importAny(JSON.stringify({ "@type": "SoftwareSourceCode", author }));
  expect((await read({ name: "Hua Luogeng", id: "invalid" })).authors[0]?.orcid).toBeUndefined();
  expect((await read([null, false, "Name", {}, { name: "  " }])).authors).toEqual([]);
  expect((await read(undefined)).authors).toEqual([]);
  // The limit belongs to the caller (normalizeRoster, the modal), not to the reader.
  expect((await read(Array.from({ length: MAX_AUTHORS + 1 }, () => ({ name: "Researcher" })))).authors).toHaveLength(
    MAX_AUTHORS + 1,
  );
  await expect(importAny("x".repeat(MAX_IMPORT_BYTES + 1))).rejects.toThrow(/2 MB/);
});

it("skips one unusable name instead of discarding the file", async () => {
  const { authors } = await importAny(
    JSON.stringify({ "@type": "SoftwareSourceCode", author: [{ name: "Ana Lima" }, { name: "42" }] }),
  );
  expect(authors.map((author) => author.name)).toEqual(["Ana Lima"]);
});

it("reads contributor as non-authors and round-trips toCodemeta", async () => {
  const ana = createAuthor("Ana Lima", { contributions: [{ role: "Software", score: 100 }] });
  const grace = createAuthor("Grace Hopper", {
    contributorType: "non-author",
    contributions: [{ role: "Software", score: 100 }],
  });
  const { metadata } = toCodemeta([ana, grace]);
  const { authors } = await importAny(JSON.stringify({ "@type": "SoftwareSourceCode", ...metadata }));
  expect(authors.map(({ name, contributorType }) => ({ name, contributorType }))).toEqual([
    { name: "Ana Lima", contributorType: "author" },
    { name: "Grace Hopper", contributorType: "non-author" },
  ]);
});

it("keeps a person listed as both author and contributor once, as an author", async () => {
  const ada = { name: "Ada Lovelace", "@id": "https://orcid.org/0000-0002-1825-0097" };
  const { authors } = await importAny(
    JSON.stringify({
      "@type": "SoftwareSourceCode",
      author: [ada, { name: "Ana Lima" }],
      contributor: [ada, { name: "ana lima" }, { name: "Grace Hopper" }],
    }),
  );
  expect(authors.map(({ name, contributorType }) => [name, contributorType])).toEqual([
    ["Ada Lovelace", "author"],
    ["Ana Lima", "author"],
    ["Grace Hopper", "non-author"],
  ]);
});

it("preserves structured family names and name order", async () => {
  const result = await importAny(
    JSON.stringify({
      "@type": "SoftwareSourceCode",
      author: [
        { givenName: "Ana", familyName: "García López" },
        { name: "Wang Xiaoming", givenName: "Xiaoming", familyName: "Wang" },
      ],
    }),
  );
  expect(result.authors.map(({ firstName, middleName, surname }) => ({ firstName, middleName, surname }))).toEqual([
    { firstName: "Ana", middleName: "", surname: "García López" },
    { firstName: "Xiaoming", middleName: "", surname: "Wang" },
  ]);
});

it("counts people rather than linked roles against the contributor limit", async () => {
  const author = Array.from({ length: 15 }, () => [
    { type: "Person", name: "Researcher" },
    ...Array.from({ length: 14 }, () => ({ type: "Role", roleName: "Software" })),
  ]).flat();
  expect(
    (await importAny(JSON.stringify({ "@context": "https://w3id.org/codemeta/3.0", author }))).authors,
  ).toHaveLength(15);
});

it("detects one recorded citation fixture per supported format", async () => {
  for (const [file, format] of [
    ["CITATION.cff", "cff"],
    ["codemeta.json", "codemeta"],
    ["zenodo.json", "zenodo"],
  ] as const) {
    const text = readFileSync(new URL(`./fixtures/citations/${file}`, import.meta.url), "utf8");
    expect(detectFormat(text)).toBe(format);
    const convertCitation = vi.fn(async () =>
      readFileSync(new URL("./fixtures/citations/codemeta.json", import.meta.url), "utf8"),
    );
    const result = await importAny(text, { convertCitation });
    expect(result.authors[0]).toMatchObject({ name: "Antonie van Leeuwenhoek", orcid: "0000-0002-1825-0097" });
  }
});

const codemetaOf = (fields: object) => JSON.stringify({ "@type": "SoftwareSourceCode", ...fields });

it("reads a single author object and a Role under either type key", async () => {
  const read = async (author: unknown) => (await importAny(codemetaOf({ author }))).authors.map((a) => a.name);
  expect(await read({ name: "Hua Luogeng" })).toEqual(["Hua Luogeng"]);
  expect(
    await read([{ "@type": "Role", name: "Lead" }, { type: "Role", name: "Maintainer" }, { name: "Ana" }]),
  ).toEqual(["Ana"]);
});

it("keeps structured name parts, and only for people", async () => {
  const read = async (author: object) => {
    const [a] = (await importAny(codemetaOf({ author: [author] }))).authors;
    return a && { name: a.name, first: a.firstName, middle: a.middleName, surname: a.surname };
  };
  expect(await read({ givenName: "  Ana  Maria ", familyName: "Lima" })).toMatchObject({
    first: "Ana",
    middle: "Maria",
    surname: "Lima",
  });
  expect(await read({ familyName: "Lima" })).toMatchObject({ name: "Lima", first: "", surname: "Lima" });
  expect(await read({ givenName: "Ana" })).toMatchObject({ name: "Ana", first: "Ana", middle: "", surname: "" });
  // Non-string parts are ignored, not printed into the name.
  expect(await read({ givenName: 5, familyName: "Lima" })).toMatchObject({ name: "Lima" });
  expect(await read({ givenName: ["Ana"], familyName: "Lima" })).toMatchObject({ name: "Lima" });
  expect(await read({ givenName: "Ana  Maria  Clara" })).toMatchObject({
    first: "Ana",
    middle: "Maria Clara",
    surname: "",
  });
  expect(await read({ name: "Ana Maria Lima" })).toMatchObject({ first: "Ana", middle: "Maria", surname: "Lima" });
  // An organisation keeps its name as written, not rebuilt from given and family names, and gets
  // no ORCID. The name still splits into parts like any other.
  expect(
    await read({ type: "Organization", name: "Acme Consortium Ltd", givenName: "Zed", familyName: "Quux" }),
  ).toMatchObject({ first: "Acme", middle: "Consortium", surname: "Ltd" });
  const [org] = (
    await importAny(
      codemetaOf({ author: [{ "@type": "Organization", name: "Lab Group", "@id": "0000-0002-1825-0097" }] }),
    )
  ).authors;
  expect(org?.orcid).toBeUndefined();
  const [person] = (await importAny(codemetaOf({ author: [{ name: "Ana Lima", id: "0000-0002-1825-0097" }] }))).authors;
  expect(person?.orcid).toBe("0000-0002-1825-0097");
});

it("accepts exactly the size cap and refuses one byte more, for the file and for converted metadata", async () => {
  const pad = (n: number) => `${codemeta}${" ".repeat(n - new TextEncoder().encode(codemeta).length)}`;
  expect((await importAny(pad(MAX_IMPORT_BYTES))).authors).toHaveLength(2);
  await expect(importAny(pad(MAX_IMPORT_BYTES + 1))).rejects.toThrow("Use a file smaller than 2 MB.");
  const cff = "cff-version: 1.2.0\ntitle: Example";
  expect((await importAny(cff, { convertCitation: async () => pad(MAX_IMPORT_BYTES) })).authors).toHaveLength(2);
  await expect(importAny(cff, { convertCitation: async () => pad(MAX_IMPORT_BYTES + 1) })).rejects.toThrow(
    "Use a file smaller than 2 MB.",
  );
});

it("treats converted metadata with no object as having no authors", async () => {
  const result = await importAny("cff-version: 1.2.0", { convertCitation: async () => "null" });
  expect(result.authors).toEqual([]);
});

it.each([
  ["@type alone", { "@type": "SoftwareSourceCode" }],
  ["a CodeMeta context alone", { "@context": "https://doi.org/10.5063/schema/codemeta-2.0" }],
  ["a context list that names CodeMeta", { "@context": ["https://schema.org", "https://w3id.org/codemeta/3.0"] }],
])("detects CodeMeta from %s", (_, fields) => {
  expect(detectFormat(JSON.stringify({ ...fields, author: [] }))).toBe("codemeta");
});

it("does not take other JSON for CodeMeta or Zenodo", () => {
  expect(detectFormat(JSON.stringify({ "@context": "https://schema.org", "@type": "Dataset" }))).toBe("json");
  expect(detectFormat(JSON.stringify({ creators: "x" }))).toBe("json");
  expect(detectFormat(JSON.stringify([{ creators: [{ name: "A" }] }]))).toBe("json");
});

it("collapses stray spaces in CodeMeta names", async () => {
  const { authors } = await importAny(
    JSON.stringify({
      "@type": "SoftwareSourceCode",
      author: [{ givenName: "Ana  Maria", familyName: " Lima " }, { name: "Sven   Berg" }],
    }),
  );
  expect(authors.map((author) => author.name)).toEqual(["Ana Maria Lima", "Sven Berg"]);
  expect(authors[0]).toMatchObject({ firstName: "Ana", middleName: "Maria", surname: "Lima" });
});

it("skips a null CodeMeta entry and keeps an ORCID only on a person", async () => {
  const { authors } = await importAny(
    JSON.stringify({
      "@type": "SoftwareSourceCode",
      author: [
        null,
        { "@type": "Person", name: "Ana Lima", "@id": "https://orcid.org/0000-0002-1825-0097" },
        { "@type": "Organization", name: "Duin Lab", "@id": "https://orcid.org/0000-0002-1825-0097" },
        { "@type": "Person", name: "Sven Berg", "@id": "https://example.org/sven" },
      ],
    }),
  );
  expect(authors.map((author) => [author.name, author.orcid])).toEqual([
    ["Ana Lima", "0000-0002-1825-0097"],
    ["Duin Lab", undefined],
    ["Sven Berg", undefined],
  ]);
});

it("imports a full draft back from every export the app reads, under the size cap", async () => {
  // The census's largest article with per-person roles names 340 people (oa-2026-10).
  expect(MAX_AUTHORS).toBeGreaterThanOrEqual(340);
  // The worst case: long names, ORCIDs and most roles filled, at MAX_AUTHORS. JATS is the largest.
  const authors = Array.from({ length: MAX_AUTHORS }, (_, i) => {
    const author = createAuthor(`Rosalind Elsie Franklin-Lavoisier van der Waals ${i}`, {
      orcid: "0000-0002-1825-0097",
    });
    for (const [k, c] of author.contributions.entries()) if ((i + k) % 3 !== 0) c.score = 67;
    return author;
  });
  for (const text of [
    toJson(authors),
    toCsv(authors),
    toJats4rXml(authors),
    toCrossrefContributors(authors),
    JSON.stringify(toCodemeta(authors).metadata),
    toTenzing(authors),
  ]) {
    expect(new TextEncoder().encode(text).length).toBeLessThan(MAX_IMPORT_BYTES * 0.75);
    expect((await importAny(text)).authors).toHaveLength(MAX_AUTHORS);
  }
});
