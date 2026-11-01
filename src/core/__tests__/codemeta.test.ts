// biome-ignore lint/correctness/noNodejsModules: the shared name corpus is a fixture on disk.
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Author } from "../author";
import { toCodemeta } from "../export/codemeta";
import { createAuthor } from "../parse-authors";

const software = [{ role: "Software" as const, score: 100 }];
const corpus: { cases: { display: string; matrix: Partial<Author>; codemeta: object }[] } = JSON.parse(
  readFileSync("conformance/names/people-v1.json", "utf8"),
);

describe("CodeMeta attribution", () => {
  it.each(corpus.cases)("preserves the shared name contract: $display", ({ display, matrix, codemeta }) => {
    const person = createAuthor(display, { ...matrix, contributions: software });
    const { metadata } = toCodemeta([person]);
    expect(metadata.author[0]).toMatchObject({ type: "Person", name: display.normalize("NFC"), ...codemeta });
  });

  it("keeps local links deterministic across imports with new roster ids", () => {
    const one = createAuthor("Katherine Johnson", { contributions: software, contributorType: "non-author" });
    const two = { ...one, id: "another-import" };
    expect(toCodemeta([one])).toEqual(toCodemeta([two]));
    expect(toCodemeta([one]).metadata).toMatchObject({
      author: [],
      contributor: [{ type: "Person" }, { type: "Role" }],
    });
  });

  it("normalizes ORCID URLs and leaves unassigned rows out", () => {
    const person = createAuthor("Josiah Carberry", {
      orcid: "https://orcid.org/0000-0002-1825-0097",
      contributions: software,
    });
    person.orcid = "https://orcid.org/0000-0002-1825-0097";
    expect(toCodemeta([person, createAuthor("Antonie van Leeuwenhoek")])).toEqual({
      metadata: {
        "@context": "https://w3id.org/codemeta/3.0",
        author: [
          {
            type: "Person",
            id: "https://orcid.org/0000-0002-1825-0097",
            name: "Josiah Carberry",
            givenName: "Josiah",
            familyName: "Carberry",
          },
          {
            type: "Role",
            "schema:author": "https://orcid.org/0000-0002-1825-0097",
            roleName: "https://credit.niso.org/contributor-roles/software/",
          },
        ],
        contributor: [],
      },
      warnings: ["CodeMeta omits scores and contribution levels; keep the original roster JSON."],
    });
    expect(toCodemeta([])).toEqual({
      metadata: { "@context": "https://w3id.org/codemeta/3.0", author: [], contributor: [] },
      warnings: [],
    });
  });

  it("links multiple active roles to one Person and omits zero scores", () => {
    const person = createAuthor("Josiah Carberry", {
      contributions: [
        { role: "Software", score: 100 },
        { role: "Formal analysis", score: 33 },
        { role: "Investigation", score: 0 },
      ],
    });
    expect(toCodemeta([person]).metadata.author).toEqual([
      {
        type: "Person",
        id: "#credit-matrix-person-1",
        name: "Josiah Carberry",
        givenName: "Josiah",
        familyName: "Carberry",
      },
      {
        type: "Role",
        "schema:author": "#credit-matrix-person-1",
        roleName: "https://credit.niso.org/contributor-roles/formal-analysis/",
      },
      {
        type: "Role",
        "schema:author": "#credit-matrix-person-1",
        roleName: "https://credit.niso.org/contributor-roles/software/",
      },
    ]);
  });

  it("does not manufacture structured names for mononyms", () => {
    const person = createAuthor("Euclid", { contributions: software });
    expect(toCodemeta([person]).metadata.author[0]).toEqual({
      type: "Person",
      id: "#credit-matrix-person-1",
      name: "Euclid",
    });
  });

  it("links every active role to its own Person without changing scores", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ score: fc.integer({ min: 0, max: 100 }), nonAuthor: fc.boolean() }), { maxLength: 20 }),
        (rows) => {
          const authors = rows.map(({ score, nonAuthor }) =>
            createAuthor("Josiah Carberry", {
              contributions: [{ role: "Software", score }],
              contributorType: nonAuthor ? "non-author" : "author",
            }),
          );
          const before = structuredClone(authors);
          const { metadata } = toCodemeta(authors);
          for (const [field, nonAuthor] of [
            ["author", false],
            ["contributor", true],
          ] as const) {
            const entries = metadata[field];
            expect(entries).toHaveLength(rows.filter((row) => row.score > 0 && row.nonAuthor === nonAuthor).length * 2);
            for (let i = 0; i < entries.length; i += 2) {
              const person = entries[i];
              if (person?.type !== "Person") throw new Error("Expected a linked person");
              expect(entries[i + 1]).toEqual({
                type: "Role",
                "schema:author": person.id,
                roleName: "https://credit.niso.org/contributor-roles/software/",
              });
            }
          }
          expect(authors).toEqual(before);
        },
      ),
    );
  });
});
