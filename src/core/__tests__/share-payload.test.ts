import { describe, expect, it } from "vitest";
import { toJson } from "../export/json";
import { createAuthor } from "../parse-authors";
import { fromSharePayload, toSharePayload } from "../share-payload";

function makeAuthors() {
  return [
    createAuthor("Jane A. Smith", {
      orcid: "0000-0002-1825-0097",
      corresponding: true,
      equalContribution: true,
      contributions: [
        { role: "Conceptualization", score: 100 },
        { role: "Software", score: 50 },
      ],
    }),
    createAuthor("Bob White", {
      contributorType: "non-author",
      contributions: [{ role: "Investigation", score: 100 }],
    }),
  ];
}

describe("share payload v2", () => {
  it("round-trips authors with their stable ids, title, claim, source draft, and reply flag", () => {
    const authors = makeAuthors();
    const bob = authors[1];
    if (!bob) throw new Error("expected Bob");
    const restored = fromSharePayload(
      toSharePayload({
        authors,
        title: "Trust in electric eels",
        claimId: bob.id,
        sourceDraftId: "11111111-2222-3333-4444-555555555555",
        reply: true,
      }),
    );

    expect(restored.authors.map((a) => a.id)).toEqual([bob.id]);
    expect(restored.title).toBe("Trust in electric eels");
    expect(restored.claimId).toBe(bob.id);
    expect(restored.sourceDraftId).toBe("11111111-2222-3333-4444-555555555555");
    expect(restored.reply).toBe(true);
  });

  it("carries only the claimed contributor's row on a claim link, never the rest of the roster", () => {
    const authors = makeAuthors();
    const jane = authors[0];
    if (!jane) throw new Error("expected Jane");
    const payload = toSharePayload({ authors, claimId: jane.id, sourceDraftId: "draft-1" });

    expect(payload).not.toContain("Bob White");
    const restored = fromSharePayload(payload);
    expect(restored.authors.map((a) => a.name)).toEqual(["Jane A. Smith"]);
    expect(restored.authors[0]?.orcid).toBe("0000-0002-1825-0097");
    expect(restored.claimId).toBe(jane.id);
  });

  it("still opens a full-roster claim link from before claims were trimmed", () => {
    const authors = makeAuthors();
    const raw = JSON.parse(toSharePayload({ authors }));
    const restored = fromSharePayload(JSON.stringify({ ...raw, c: authors[1]?.id, d: "draft-1" }));
    expect(restored.authors).toHaveLength(2);
    expect(restored.claimId).toBe(authors[1]?.id);
  });

  it("round-trips a plain share with no claim, no source, no reply", () => {
    const restored = fromSharePayload(toSharePayload({ authors: makeAuthors() }));
    expect(restored.claimId).toBeNull();
    expect(restored.sourceDraftId).toBeNull();
    expect(restored.reply).toBe(false);
    expect(restored.title).toBe("");
    expect(restored.authors[1]?.contributorType).toBe("non-author");
    expect(restored.authors[0]?.corresponding).toBe(true);
  });

  it("sends a blank ask with the row's scores zeroed, and says when it was sent", () => {
    const authors = makeAuthors();
    const jane = authors[0];
    if (!jane) throw new Error("expected Jane");
    const sentAt = 1_760_000_000_000;
    const payload = toSharePayload({ authors, claimId: jane.id, sourceDraftId: "draft-1", blank: true, sentAt });

    expect(JSON.parse(payload)).toMatchObject({ b: 1, w: sentAt });
    const restored = fromSharePayload(payload);
    expect(restored.blank).toBe(true);
    expect(restored.sentAt).toBe(sentAt);
    expect(restored.authors[0]?.contributions.every((c) => c.score === 0)).toBe(true);
    expect(restored.authors[0]?.orcid).toBe(jane.orcid);
  });

  it("keeps the guess on a pre-filled ask", () => {
    const authors = makeAuthors();
    const jane = authors[0];
    if (!jane) throw new Error("expected Jane");
    const restored = fromSharePayload(
      toSharePayload({ authors, claimId: jane.id, sourceDraftId: "draft-1", sentAt: 5 }),
    );
    expect(restored.blank).toBe(false);
    expect(restored.sentAt).toBe(5);
    expect(restored.authors[0]?.contributions.find((c) => c.role === "Conceptualization")?.score).toBe(100);
  });

  it("never blanks a share that is not addressed to anyone", () => {
    const payload = toSharePayload({ authors: makeAuthors(), blank: true });
    expect(JSON.parse(payload)).not.toHaveProperty("b");
    expect(fromSharePayload(payload).authors[0]?.contributions.some((c) => c.score > 0)).toBe(true);
  });

  it("reads a link from before blank asks and send times as pre-filled and undated", () => {
    // Frozen: the shape v0.6.0 wrote, with no `b` or `w`.
    const old =
      '{"v":2,"d":"draft-1","c":"jane-1","a":[{"i":"jane-1","n":"Jane Smith","s":[100,0,0,0,0,0,0,0,0,0,0,0,0,0]}]}';
    const restored = fromSharePayload(old);
    expect(restored.blank).toBe(false);
    expect(restored.sentAt).toBeNull();
    expect(restored.authors[0]?.contributions[0]?.score).toBe(100);
  });

  it("rejects a v1 payload outright", () => {
    expect(() => fromSharePayload(JSON.stringify({ v: 1, a: [{ n: "Jane Smith", s: [] }] }))).toThrow();
  });

  it("rejects a claim naming a contributor the payload does not carry", () => {
    const payload = toSharePayload({
      authors: makeAuthors(),
      claimId: makeAuthors()[0]?.id ?? "x", // fresh call → different ids than encoded
      sourceDraftId: "11111111-2222-3333-4444-555555555555",
    });
    expect(() => fromSharePayload(payload)).toThrow();
  });

  it("rejects a claim without a source draft, and a reply without a claim", () => {
    const authors = makeAuthors();
    const raw = JSON.parse(toSharePayload({ authors }));
    expect(() => fromSharePayload(JSON.stringify({ ...raw, c: authors[0]?.id }))).toThrow();
    expect(() => fromSharePayload(JSON.stringify({ ...raw, r: 1 }))).toThrow();
  });

  it("rejects duplicate contributor ids", () => {
    const raw = JSON.parse(toSharePayload({ authors: makeAuthors() }));
    raw.a[1].i = raw.a[0].i;
    expect(() => fromSharePayload(JSON.stringify(raw))).toThrow();
  });

  it("clamps a hand-edited score rather than trusting it", () => {
    const raw = JSON.parse(toSharePayload({ authors: makeAuthors() }));
    raw.a[0].s = [900, -5, 50.4];
    const restored = fromSharePayload(JSON.stringify(raw));
    const scores = restored.authors[0]?.contributions ?? [];
    expect(scores[0]?.score).toBe(100);
    expect(scores[1]?.score).toBe(0);
    expect(scores[2]?.score).toBe(50);
  });

  it("is much smaller than the JSON export it replaces", () => {
    const authors = Array.from({ length: 10 }, (_, i) =>
      createAuthor(`Author ${i} Name`, { contributions: [{ role: "Software", score: 66 }] }),
    );
    expect(toSharePayload({ authors }).length).toBeLessThan(toJson(authors).length / 4);
  });

  it("gives contributors unique initials, as the workspace does", () => {
    const authors = [createAuthor("Jane Smith"), createAuthor("John Smith")];
    const restored = fromSharePayload(toSharePayload({ authors }));
    expect(restored.authors[0]?.initials).not.toBe(restored.authors[1]?.initials);
  });
});
