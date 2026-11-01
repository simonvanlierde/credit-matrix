// biome-ignore-all lint/correctness/noNodejsModules: the shared conformance corpus lives on disk.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAuthor, fromJson, normalizeRoster, toJson } from "../index";

const corpus = JSON.parse(
  readFileSync(new URL("../../../conformance/names/people-v1.json", import.meta.url), "utf8"),
) as {
  version: number;
  orcid_cases: { input: string; normalized: string; checksum_valid: boolean }[];
  cases: {
    id: string;
    display: string;
    matrix: { firstName: string; middleName: string; surname: string; initials: string };
    orcid?: string;
  }[];
};

describe("shared structured-name corpus", () => {
  it("reads the supported corpus version", () => expect(corpus.version).toBe(1));
  for (const row of corpus.orcid_cases) {
    it(`validates the checksum of ${row.input}`, () => {
      if (row.checksum_valid) {
        expect(createAuthor("Josiah Carberry", { orcid: row.input }).orcid).toBe(row.normalized);
      } else {
        expect(() => createAuthor("Josiah Carberry", { orcid: row.input })).toThrow("Invalid ORCID");
      }
    });
  }
  it("re-parses stale parts that assign the whole display to one field", () => {
    for (const parts of [
      { firstName: "", middleName: "", surname: "Marie Curie" },
      { firstName: "MarieCurie", middleName: "", surname: "" },
    ]) {
      const [author] = normalizeRoster([createAuthor("Marie Curie", parts)]);
      expect(author).toMatchObject({ firstName: "Marie", middleName: "", surname: "Curie", initials: "MC" });
    }
  });
  for (const row of corpus.cases) {
    it(`preserves ${row.id} through a roster rebuild and JSON export`, () => {
      if (row.id === "nfd") expect(row.display).not.toBe(row.display.normalize("NFC"));
      const author = createAuthor(row.display, { ...row.matrix, id: row.id, orcid: row.orcid });
      const [rebuilt] = normalizeRoster(fromJson(toJson([author])).authors);
      expect(rebuilt).toMatchObject({
        ...Object.fromEntries(Object.entries(row.matrix).map(([key, value]) => [key, value.normalize("NFC")])),
        name: row.display.normalize("NFC"),
      });
    });
  }
});
