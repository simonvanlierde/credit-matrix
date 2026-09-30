import { describe, expect, it } from "vitest";
import { keepKnownIds, mergeContributorRow } from "../merge-row";
import { createAuthor } from "../parse-authors";

const JANE_ORCID = "0000-0002-1825-0097";

const DRAFT = [
  createAuthor("Jane A. Smith", { orcid: JANE_ORCID, contributions: [{ role: "Conceptualization", score: 100 }] }),
  createAuthor("Bob White", { contributions: [{ role: "Investigation", score: 50 }] }),
  createAuthor("Carol Davis", { contributions: [{ role: "Software", score: 100 }] }),
];

/** Your roster: a fresh copy each time, with the ids a claim link carries. */
function draft() {
  return structuredClone(DRAFT);
}

/** What a co-author sends back: the draft, with their own row filled in. */
function returned(edit: (authors: ReturnType<typeof draft>) => void) {
  const authors = draft();
  edit(authors);
  return authors;
}

/** The id of the row at `index`, the way a claim link carries it. */
function idAt(authors: { id: string }[], index: number): string {
  const author = authors[index];
  if (!author) throw new Error(`expected a row at ${index}`);
  return author.id;
}

function scoreFor(author: { contributions: { role: string; score: number }[] }, role: string): number {
  return author.contributions.find((contribution) => contribution.role === role)?.score ?? 0;
}

describe("mergeContributorRow", () => {
  it("takes the claimed row and discards their edits to everyone else", () => {
    const incoming = returned((authors) => {
      const [, bob, carol] = authors;
      if (!(bob && carol)) throw new Error("expected the draft");
      bob.contributions = [{ role: "Investigation", score: 100 }];
      // Bob has opinions about Carol. They are not collected.
      carol.contributions = [{ role: "Software", score: 0 }];
    });

    const result = mergeContributorRow(draft(), incoming, idAt(incoming, 1));

    expect(result.merged?.name).toBe("Bob White");
    expect(scoreFor(result.authors[1] as never, "Investigation")).toBe(100);
    expect(scoreFor(result.authors[2] as never, "Software")).toBe(100);
  });

  it("lets a co-author clear a role you had guessed at", () => {
    const incoming = returned((authors) => {
      const bob = authors[1];
      if (!bob) throw new Error("expected the draft");
      bob.contributions = [];
    });

    const result = mergeContributorRow(draft(), incoming, idAt(incoming, 1));
    expect(scoreFor(result.authors[1] as never, "Investigation")).toBe(0);
  });

  it("does not fall back to the claimed position", () => {
    // The position says who answered, never who they are in your list: an
    // unrecognised contributor must not land on whoever sits at that index.
    const incoming = [createAuthor("Erik Nilsson", { contributions: [{ role: "Software", score: 100 }] })];
    const result = mergeContributorRow(draft(), incoming, idAt(incoming, 0));

    expect(result.authors[0]?.name).toBe("Jane A. Smith");
    expect(scoreFor(result.authors[0] as never, "Conceptualization")).toBe(100);
    expect(result.unmatched?.name).toBe("Erik Nilsson");
  });

  it("matches on ORCID even when they corrected their own name", () => {
    const incoming = returned((authors) => {
      const jane = authors[0];
      if (!jane) throw new Error("expected the draft");
      jane.name = "Jane Alexandra Smith";
      jane.contributions = [{ role: "Supervision", score: 100 }];
    });

    const result = mergeContributorRow(draft(), incoming, idAt(incoming, 0));

    expect(result.merged).not.toBeNull();
    // Their roles land, and so does the spelling they chose for themselves.
    expect(scoreFor(result.authors[0] as never, "Supervision")).toBe(100);
    expect(result.authors[0]?.name).toBe("Jane Alexandra Smith");
  });

  it("takes their ORCID as answered: filling a gap, correcting yours, or clearing it", () => {
    const bob = createAuthor("Bob White");
    const answered = { ...bob, orcid: JANE_ORCID };
    expect(mergeContributorRow([bob], [answered], bob.id).authors[0]?.orcid).toBe(JANE_ORCID);

    const held = { ...bob, orcid: "0000-0001-5109-3700" };
    expect(mergeContributorRow([held], [answered], bob.id).authors[0]?.orcid).toBe(JANE_ORCID);

    const withoutId = { ...bob, orcid: undefined };
    expect(mergeContributorRow([answered], [withoutId], bob.id).authors[0]?.orcid).toBeUndefined();
  });

  it("keeps your row id while shipping the name they typed for themselves", () => {
    const jane = createAuthor("Jane A. Smith", { orcid: JANE_ORCID });
    const reply = { ...jane, name: "Jane Alexandra Smith" };

    const result = mergeContributorRow([jane], [reply], jane.id);

    expect(result.merged?.name).toBe("Jane Alexandra Smith");
    expect(result.merged?.id).toBe(jane.id);
  });

  it("carries the markers the co-author set on themselves", () => {
    const incoming = returned((authors) => {
      const bob = authors[1];
      if (!bob) throw new Error("expected the draft");
      bob.corresponding = true;
      bob.equalContribution = true;
    });

    const result = mergeContributorRow(draft(), incoming, idAt(incoming, 1));
    expect(result.authors[1]?.corresponding).toBe(true);
    expect(result.authors[1]?.equalContribution).toBe(true);
  });

  it("reports someone who matches nobody, rather than silently doing nothing", () => {
    const incoming = [createAuthor("Erik Nilsson", { contributions: [{ role: "Software", score: 100 }] })];

    const result = mergeContributorRow(draft(), incoming, idAt(incoming, 0));

    expect(result.merged).toBeNull();
    expect(result.unmatched?.name).toBe("Erik Nilsson");
    expect(result.authors).toHaveLength(3);
  });

  it("does nothing when the claim id is not in the returned list", () => {
    const result = mergeContributorRow(draft(), draft(), "no-such-id");
    expect(result).toEqual({ authors: expect.any(Array), merged: null, unmatched: null });
    expect(result.authors).toHaveLength(3);
  });

  it("does nothing with an empty return", () => {
    const result = mergeContributorRow(draft(), [], "any-id");
    expect(result.merged).toBeNull();
    expect(result.unmatched).toBeNull();
  });

  it("leaves the rest of the list in its original order", () => {
    const incoming = draft();
    const result = mergeContributorRow(draft(), incoming, idAt(incoming, 1));
    expect(result.authors.map((author) => author.name)).toEqual(["Jane A. Smith", "Bob White", "Carol Davis"]);
  });
});

describe("matching by id", () => {
  it("selects the claimed row by id, surviving reorder and deletion in the reply", () => {
    const [jane, bob] = [createAuthor("Jane Smith"), createAuthor("Bob White")];
    const current = [jane, bob];
    // Reply roster reordered; ids preserved (as the v2 payload guarantees).
    const incoming = [{ ...bob, contributions: [{ role: "Investigation" as const, score: 100 }] }, jane];
    const result = mergeContributorRow(current, incoming, bob.id);
    expect(result.merged?.name).toBe("Bob White");
    expect(result.authors[1]?.contributions.find((c) => c.role === "Investigation")?.score).toBe(100);
  });

  it("never lets a reply land on a row whose id is not the claim, whatever ORCID or name it carries", () => {
    // A forged reply: an id nobody was asked under, dressed in Jane's iD and name.
    const current = draft();
    const forged = createAuthor("Jane A. Smith", {
      orcid: JANE_ORCID,
      contributions: [{ role: "Software", score: 100 }],
    });
    const result = mergeContributorRow(current, [forged], forged.id);
    expect(result.merged).toBeNull();
    expect(result.unmatched?.id).toBe(forged.id);
    expect(result.authors).toBe(current);
  });

  it("returns unmatched when the claim id is absent from the incoming roster", () => {
    const current = [createAuthor("Jane Smith")];
    const result = mergeContributorRow(current, current, "no-such-id");
    expect(result.merged).toBeNull();
    expect(result.unmatched).toBeNull();
    expect(result.authors).toBe(current);
  });

  it("takes the claimed row's contributor type", () => {
    const jane = createAuthor("Jane Smith");
    const reply = { ...jane, contributorType: "non-author" as const };
    const result = mergeContributorRow([jane], [reply], jane.id);
    expect(result.merged?.contributorType).toBe("non-author");
  });
});

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
    // A reply to the old ask now merges into the re-imported row.
    const reply = returned(([jane]) => {
      if (jane) jane.contributions[0] = { role: "Conceptualization", score: 33 };
    });
    expect(mergeContributorRow(result, reply, idAt(current, 0)).merged?.name).toBe("Jane A. Smith");
  });

  it("gives each existing id to one contributor only", () => {
    const current = draft();
    const result = keepKnownIds(current, [createAuthor("Bob White"), createAuthor("Bob White")]);
    expect(result[0]?.id).toBe(idAt(current, 1));
    expect(result[1]?.id).not.toBe(idAt(current, 1));
  });

  it("keeps an id the import already carries", () => {
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
