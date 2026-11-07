// biome-ignore lint/correctness/noNodejsModules: fixture files are read only by tests.
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { MAX_AUTHORS } from "../author";
import { detectFormat, importAny } from "../import";

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
  await expect(importAny(text)).rejects.toThrow(/citesync/);
});

it("handles singleton, missing and malformed CodeMeta author entries without reading linked Role entries", async () => {
  const read = (author: unknown) => importAny(JSON.stringify({ "@type": "SoftwareSourceCode", author }));
  expect((await read({ name: "Tu Youyou", id: "invalid" })).authors[0]?.orcid).toBeUndefined();
  expect((await read([null, false, "Name", {}, { name: "  " }])).authors).toEqual([]);
  expect((await read(undefined)).authors).toEqual([]);
  await expect(read(Array.from({ length: MAX_AUTHORS + 1 }, () => ({ name: "Researcher" })))).rejects.toThrow(
    /Too many/,
  );
  await expect(read({ name: "1" })).rejects.toThrow();
  await expect(importAny("x".repeat(1_000_001))).rejects.toThrow(/1 MB/);
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
