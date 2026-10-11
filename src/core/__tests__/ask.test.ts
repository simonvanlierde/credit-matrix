import { describe, expect, it } from "vitest";
import type { Ask, AskState, Choice, Target } from "../ask";
import { ASK_TARGETS, applyPatch, askStep, importAsks, review } from "../ask";
import type { Author } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { fromJson, toJson } from "../export/json";
import { keepKnownIds } from "../merge-row";
import { createAuthor, deduplicateAuthorInitials } from "../parse-authors";

/** Small seeded generator (Park–Miller), so a failing case reruns the same. */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const NAMES = ["Ada Lovelace", "Marie Curie", "Alan Turing", "Anna Andersson", "Ali Ahmed", "Mei Lin", "Bob White"];
const SCORES = [0, 0, 0, 20, 50, 100];

function randomRow(random: () => number, name: string, id: string): Author {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;
  return createAuthor(name, {
    id,
    contributions: CREDIT_ROLES.map((role) => ({ role: role.name, score: pick(SCORES) })),
    equalContribution: random() < 0.3,
    corresponding: random() < 0.3,
    contributorType: random() < 0.2 ? "non-author" : "author",
  });
}

/** A random roster, an asked contributor, and a reply row from them under a possibly new name. */
function scenario(seed: number) {
  const random = rng(seed);
  const size = 2 + Math.floor(random() * 5);
  const authors = deduplicateAuthorInitials(
    Array.from({ length: size }, (_, index) => randomRow(random, NAMES[index] as string, `c${index}`)),
  );
  const target = authors[Math.floor(random() * size)] as Author;
  const asks: Record<string, Ask> = { [target.id]: { sentAt: 1000, prefilled: random() < 0.5 } };
  const replyName = random() < 0.5 ? target.name : `${target.name} Jr`;
  const row = randomRow(random, replyName, target.id);
  return { state: { authors, asks } as AskState, target, row, random };
}

const STORED = ["name", "orcid", "contributorType", "contributions", "equalContribution", "corresponding"] as const;
const stored = (author: Author) => STORED.map((field) => JSON.stringify(author[field]));

function receive(state: AskState, id: string, row: Author, sentAt: number | null, at = 2000) {
  const step = askStep(state, { kind: "reply", contributorId: id, row, sentAt, at });
  return { ...step, state: applyPatch(state, step.patch) };
}

function rowOf(state: AskState, id: string): Author {
  const row = state.authors.find((author) => author.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
}

const ROUNDS = 200;

describe("askStep reply", () => {
  it("changes no other row's stored fields, and no scores or markers on the claimed row", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row } = scenario(seed);
      const { outcome, state: next } = receive(state, target.id, row, 1500);
      expect(outcome.kind).toBe("received");
      for (const before of state.authors) {
        const after = rowOf(next, before.id);
        if (before.id !== target.id) {
          expect(stored(after)).toEqual(stored(before));
          continue;
        }
        expect(after.name).toBe(row.name);
        expect(after.contributorType).toBe(row.contributorType);
        expect(after.contributions).toEqual(before.contributions);
        expect([after.equalContribution, after.corresponding]).toEqual([
          before.equalContribution,
          before.corresponding,
        ]);
      }
      expect(next.asks[target.id]?.reply?.contributions).toEqual(row.contributions);
    }
  });

  it("receiving the same reply twice equals receiving it once", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row } = scenario(seed);
      for (const sentAt of [1500, null]) {
        const once = receive(state, target.id, row, sentAt);
        const twice = receive(once.state, target.id, row, sentAt, 3000);
        expect(twice.outcome).toMatchObject({ kind: "received", duplicate: true });
        expect(twice.patch).toEqual({ rows: {}, asks: {} });
        expect(twice.state).toEqual(once.state);
      }
    }
  });

  it("ignores a reply sent before the one held", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row, random } = scenario(seed);
      const held = receive(state, target.id, row, 1500).state;
      const older = randomRow(random, "Someone Else", target.id);
      const step = askStep(held, { kind: "reply", contributorId: target.id, row: older, sentAt: 1499, at: 4000 });
      expect(step.outcome).toEqual({ kind: "stale" });
      expect(applyPatch(held, step.patch)).toEqual(held);
    }
  });

  it("starts a newer reply with no decisions, so a repeated objection shows again", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row } = scenario(seed);
      const first = receive(state, target.id, row, 1500).state;
      const kept = settle(first, target.id, "mine");
      expect(review(rowOf(kept, target.id), kept.asks[target.id]).open).toEqual([]);
      const again = receive(kept, target.id, row, 1600, 5000);
      const ask = again.state.asks[target.id];
      expect(ask?.reply?.decisions).toEqual({});
      expect(review(rowOf(again.state, target.id), ask).open.length).toBe(
        review(rowOf(first, target.id), first.asks[target.id]).open.length,
      );
    }
  });

  it("refuses a broken row, a row under another id, and a contributor not in the roster", () => {
    const { state, target, row } = scenario(7);
    const step = (contributorId: string, payload: unknown) =>
      askStep(state, { kind: "reply", contributorId, row: payload, sentAt: 1, at: 2 }).outcome.kind;
    expect(step(target.id, { name: 3 })).toBe("broken");
    expect(step(target.id, null)).toBe("broken");
    expect(step(target.id, { ...row, id: "someone-else" })).toBe("broken");
    expect(step("nobody", { ...row, id: "nobody" })).toBe("unmatched");
  });

  it("undo restores identity and the previous ask, never scores", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row, random } = scenario(seed);
      const { undo, state: received } = receive(state, target.id, row, 1500);
      // The lead edits the row after the reply landed.
      const edited = randomRow(random, rowOf(received, target.id).name, target.id);
      const later: AskState = {
        ...received,
        authors: received.authors.map((author) =>
          author.id === target.id
            ? { ...author, contributions: edited.contributions, equalContribution: edited.equalContribution }
            : author,
        ),
      };
      const undone = applyPatch(later, undo);
      const after = rowOf(undone, target.id);
      expect([after.name, after.orcid, after.contributorType]).toEqual([
        target.name,
        target.orcid,
        target.contributorType,
      ]);
      expect(after.contributions).toEqual(edited.contributions);
      expect(after.equalContribution).toBe(edited.equalContribution);
      expect(undone.asks).toEqual(state.asks);
    }
  });
});

function settle(state: AskState, id: string, choices: Choice | Partial<Record<Target, Choice>>): AskState {
  return applyPatch(state, askStep(state, { kind: "settle", contributorId: id, choices }).patch);
}

describe("askStep settle", () => {
  it("settling every open difference, either way, gives settled", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row, random } = scenario(seed);
      const received = receive(state, target.id, row, 1500).state;
      const open = review(rowOf(received, target.id), received.asks[target.id]).open;
      const choices = Object.fromEntries(open.map((d) => [d.target, random() < 0.5 ? "theirs" : "mine"]));
      const step = askStep(received, { kind: "settle", contributorId: target.id, choices });
      expect(step.outcome).toEqual({ kind: "settled", open: 0 });
      const settled = applyPatch(received, step.patch);
      expect(review(rowOf(settled, target.id), settled.asks[target.id]).status).toEqual({ kind: "settled" });
    }
  });

  it("taking theirs copies the exact score and marker", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row } = scenario(seed);
      const taken = settle(receive(state, target.id, row, 1500).state, target.id, "theirs");
      const after = rowOf(taken, target.id);
      expect(after.contributions).toEqual(row.contributions);
      expect([after.equalContribution, after.corresponding]).toEqual([row.equalContribution, row.corresponding]);
    }
  });

  it("editing a decided role or marker reopens it", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row, random } = scenario(seed);
      const settled = settle(receive(state, target.id, row, 1500).state, target.id, random() < 0.5 ? "theirs" : "mine");
      const ask = settled.asks[target.id];
      const decided = Object.keys(ask?.reply?.decisions ?? {}) as Target[];
      if (decided.length === 0) continue;
      const edit = decided[Math.floor(random() * decided.length)] as Target;
      const before = rowOf(settled, target.id);
      const edited: Author =
        edit === "equalContribution" || edit === "corresponding"
          ? { ...before, [edit]: !before[edit] }
          : {
              ...before,
              contributions: before.contributions.map((c) =>
                c.role === edit ? { ...c, score: c.score === 100 ? 20 : 100 } : c,
              ),
            };
      const result = review(edited, ask);
      // Edited back to their level, the role matches and there is nothing to decide.
      const matchesTheirs = !Object.hasOwn(result.byTarget, edit);
      expect(result.open.some((d) => d.target === edit)).toBe(!matchesTheirs);
    }
  });

  it("treats markers like roles", () => {
    const ada = createAuthor("Ada Lovelace", { id: "ada" });
    const state: AskState = { authors: [ada], asks: { ada: { sentAt: 1, prefilled: false } } };
    const reply = createAuthor("Ada Lovelace", { id: "ada", corresponding: true });
    const received = receive(state, "ada", reply, 10).state;
    expect(review(rowOf(received, "ada"), received.asks.ada).open).toEqual([
      { target: "corresponding", kind: "added", mine: false, theirs: true },
    ]);
    const taken = settle(received, "ada", { corresponding: "theirs" });
    expect(rowOf(taken, "ada").corresponding).toBe(true);
    expect(review(rowOf(taken, "ada"), taken.asks.ada).status).toEqual({ kind: "settled" });
  });

  it("lists open differences in role order, then the markers", () => {
    const ada = createAuthor("Ada Lovelace", { id: "ada", equalContribution: true });
    const state: AskState = { authors: [ada], asks: { ada: { sentAt: 1, prefilled: false } } };
    const reply = createAuthor("Ada Lovelace", {
      id: "ada",
      contributions: [
        { role: "Software", score: 100 },
        { role: "Conceptualization", score: 20 },
      ],
    });
    const received = receive(state, "ada", reply, 10).state;
    const { open } = review(rowOf(received, "ada"), received.asks.ada);
    expect(open.map((d) => d.target)).toEqual(["Conceptualization", "Software", "equalContribution"]);
    expect(open.map((d) => d.kind)).toEqual(["added", "added", "dropped"]);
    expect(ASK_TARGETS.indexOf("Software")).toBeLessThan(ASK_TARGETS.indexOf("corresponding"));
  });

  it("says noReply before an answer and unmatched for a stranger", () => {
    const { state, target } = scenario(3);
    expect(askStep(state, { kind: "settle", contributorId: target.id, choices: "mine" }).outcome).toEqual({
      kind: "noReply",
    });
    expect(askStep(state, { kind: "settle", contributorId: "x", choices: "mine" }).outcome).toEqual({
      kind: "unmatched",
    });
  });
});

describe("askStep sent and removed", () => {
  it("a re-ask keeps the last answer and shows the row as asked", () => {
    const { state, target, row } = scenario(11);
    const received = receive(state, target.id, row, 1500).state;
    const step = askStep(received, { kind: "sent", contributorId: target.id, prefilled: true, at: 9000 });
    const asked = applyPatch(received, step.patch);
    expect(asked.asks[target.id]?.reply).toEqual(received.asks[target.id]?.reply);
    expect(review(rowOf(asked, target.id), asked.asks[target.id]).status).toEqual({ kind: "asked", prefilled: true });
    expect(applyPatch(asked, step.undo).asks).toEqual(received.asks);
  });

  it("removing a contributor deletes their ask; undo restores it", () => {
    const { state, target } = scenario(5);
    const step = askStep(state, { kind: "removed", contributorId: target.id });
    expect(applyPatch(state, step.patch).asks).toEqual({});
    expect(applyPatch(applyPatch(state, step.patch), step.undo).asks).toEqual(state.asks);
  });
});

describe("review", () => {
  it("returns the same object for the same author and ask", () => {
    const { state, target } = scenario(2);
    const ask = state.asks[target.id];
    expect(review(target, ask)).toBe(review(target, ask));
    expect(review(target)).toEqual({ status: { kind: "none" }, byTarget: {}, open: [] });
  });
});

describe("asks in JSON", () => {
  it("round-trips asks with their answers, and can leave them out", () => {
    const { state, target, row } = scenario(9);
    const received = receive(state, target.id, row, 1500).state;
    const authors = [...received.authors];
    expect(fromJson(toJson(authors, { asks: received.asks }))).toEqual({ authors, asks: received.asks });
    expect(fromJson(toJson(authors, { asks: received.asks, includeAnswers: false }))).toEqual({ authors });
  });

  it("imports answers through the id map, replacing matched ones and dropping the rest", () => {
    const ada = createAuthor("Ada Lovelace", { id: "ada" });
    const held: Record<string, Ask> = { ada: { sentAt: 1, prefilled: true } };
    const fileAda = createAuthor("Ada Lovelace", { id: "file-ada" });
    const fileNew = createAuthor("Grace Hopper", { id: "file-grace" });
    const fromFile: Record<string, Ask> = {
      "file-ada": { sentAt: 2, prefilled: false },
      "file-grace": { sentAt: 3, prefilled: false },
    };
    const incoming = [fileAda, fileNew];
    const mapped = keepKnownIds([ada], incoming);
    expect(importAsks([ada], incoming, mapped, held, fromFile)).toEqual({ ada: { sentAt: 2, prefilled: false } });
    // Into an empty draft nothing can be unmatched: the file's answers come along.
    expect(importAsks([], incoming, incoming, {}, fromFile)).toEqual(fromFile);
  });
});
