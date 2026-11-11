import { describe, expect, it } from "vitest";
import { keepKnownIds, newContributors } from "../merge-row";
import { createAuthor } from "../parse-authors";

const JANE_ORCID = "0000-0002-1825-0097";

const DRAFT = [
  createAuthor("Grace B. Hopper", { orcid: JANE_ORCID, contributions: [{ role: "Conceptualization", score: 100 }] }),
  createAuthor("Charles Darwin", { contributions: [{ role: "Investigation", score: 50 }] }),
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
      createAuthor("G. Hopper", { orcid: JANE_ORCID }),
      createAuthor("charles  darwin"),
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
    const result = keepKnownIds(current, [createAuthor("Charles Darwin"), createAuthor("Charles Darwin")]);
    expect(result[0]?.id).toBe(idAt(current, 1));
    expect(result[1]?.id).not.toBe(idAt(current, 1));
  });

  it("keeps an id the import already has", () => {
    const current = draft();
    const [bob] = current.slice(1);
    if (!bob) throw new Error("expected Charles");
    expect(keepKnownIds(current, [bob])[0]?.id).toBe(bob.id);
    // Even when an earlier row would match Charles by name.
    const result = keepKnownIds(current, [createAuthor("Charles Darwin"), bob]);
    expect(result[1]?.id).toBe(bob.id);
    expect(result[0]?.id).not.toBe(bob.id);
  });
});

describe("newContributors", () => {
  const names = (authors: { name: string }[]) => authors.map((author) => author.name);

  it("adds nobody for a person the file lists twice who is already here", () => {
    expect(newContributors(draft(), [createAuthor("Charles Darwin"), createAuthor("charles darwin")])).toEqual([]);
    expect(
      newContributors(draft(), [
        createAuthor("G. Hopper", { orcid: JANE_ORCID }),
        createAuthor("Grace", { orcid: JANE_ORCID }),
      ]),
    ).toEqual([]);
  });

  it("adds a same-name person whose ORCID iD differs from the one here", () => {
    const other = createAuthor("Grace B. Hopper", { orcid: "0000-0001-5109-3700" });
    expect(newContributors(draft(), [other])).toEqual([other]);
  });

  it("matches by name when either side has no ORCID iD", () => {
    expect(newContributors(draft(), [createAuthor("grace b. hopper")])).toEqual([]);
    expect(newContributors(draft(), [createAuthor("Charles Darwin", { orcid: "0000-0001-5109-3700" })])).toEqual([]);
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
    if (!bob) throw new Error("expected Charles");
    expect(newContributors(current, [{ ...bob, name: "Robert Darwin" }])).toEqual([]);
  });
});
