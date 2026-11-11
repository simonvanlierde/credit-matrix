import { describe, expect, it } from "vitest";
import { keepKnownIds, newContributors } from "../merge-row";
import { createAuthor } from "../parse-authors";

const JANE_ORCID = "0000-0002-1825-0097";

const DRAFT = [
  createAuthor("Jane A. Smith", { orcid: JANE_ORCID, contributions: [{ role: "Conceptualization", score: 100 }] }),
  createAuthor("Bob White", { contributions: [{ role: "Investigation", score: 50 }] }),
  createAuthor("Carol Davis", { contributions: [{ role: "Software", score: 100 }] }),
];

/** Your roster: a fresh copy each time, with the ids a claim link holds. */
function draft() {
  return structuredClone(DRAFT);
}

/** The id of the row at `index`, the way a claim link holds it. */
function idAt(authors: { id: string }[], index: number): string {
  const author = authors[index];
  if (!author) throw new Error(`expected a row at ${index}`);
  return author.id;
}

describe("keepKnownIds", () => {
  it("gives re-imported contributors the ids they already had, so open asks still match", () => {
    const current = draft();
    const imported = [
      createAuthor("Carol Davis"),
      createAuthor("J. Smith", { orcid: JANE_ORCID }),
      createAuthor("bob  white"),
      createAuthor("Dan Evans"),
    ];

    const result = keepKnownIds(current, imported);
    expect(result.map((author) => author.id)).toEqual([
      idAt(current, 2),
      idAt(current, 0),
      idAt(current, 1),
      idAt(imported, 3),
    ]);
  });

  it("gives each existing id to one contributor only", () => {
    const current = draft();
    const result = keepKnownIds(current, [createAuthor("Bob White"), createAuthor("Bob White")]);
    expect(result[0]?.id).toBe(idAt(current, 1));
    expect(result[1]?.id).not.toBe(idAt(current, 1));
  });

  it("keeps an id the import already has", () => {
    const current = draft();
    const [bob] = current.slice(1);
    if (!bob) throw new Error("expected Bob");
    expect(keepKnownIds(current, [bob])[0]?.id).toBe(bob.id);
    // Even when an earlier row would match Bob by name.
    const result = keepKnownIds(current, [createAuthor("Bob White"), bob]);
    expect(result[1]?.id).toBe(bob.id);
    expect(result[0]?.id).not.toBe(bob.id);
  });
});

describe("newContributors", () => {
  const names = (authors: { name: string }[]) => authors.map((author) => author.name);

  it("adds nobody for a person the file lists twice who is already here", () => {
    expect(newContributors(draft(), [createAuthor("Bob White"), createAuthor("bob white")])).toEqual([]);
    expect(
      newContributors(draft(), [
        createAuthor("J. Smith", { orcid: JANE_ORCID }),
        createAuthor("Jane", { orcid: JANE_ORCID }),
      ]),
    ).toEqual([]);
  });

  it("adds a same-name person whose ORCID iD differs from the one here", () => {
    const other = createAuthor("Jane A. Smith", { orcid: "0000-0001-5109-3700" });
    expect(newContributors(draft(), [other])).toEqual([other]);
  });

  it("matches by name when either side has no ORCID iD", () => {
    expect(newContributors(draft(), [createAuthor("jane a. smith")])).toEqual([]);
    expect(newContributors(draft(), [createAuthor("Bob White", { orcid: "0000-0001-5109-3700" })])).toEqual([]);
  });

  it("adds a newcomer the file lists twice once", () => {
    const added = newContributors(draft(), [
      createAuthor("Dan Evans"),
      createAuthor("dan  evans"),
      createAuthor("Eve Fox", { orcid: "0000-0001-5109-3700" }),
      createAuthor("E. Fox", { orcid: "0000-0001-5109-3700" }),
    ]);
    expect(names(added)).toEqual(["Dan Evans", "Eve Fox"]);
  });

  it("drops a row whose id is already here", () => {
    const current = draft();
    const [bob] = current.slice(1);
    if (!bob) throw new Error("expected Bob");
    expect(newContributors(current, [{ ...bob, name: "Robert White" }])).toEqual([]);
  });
});
