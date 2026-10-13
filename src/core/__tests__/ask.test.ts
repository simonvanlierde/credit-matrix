import { describe, expect, it } from "vitest";
import type { Ask, AskState, Choice, Target } from "../ask";
import { ASK_TARGETS, applyPatch, askStep, importAsks, importSelfId, review, settledAt } from "../ask";
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

  it("treats a send time after arrival as sent on arrival, so a forged future time blocks nothing", () => {
    const { state, target, row, random } = scenario(1);
    const forged = receive(state, target.id, row, Date.UTC(3000, 0, 1), 2000).state;
    expect(forged.asks[target.id]?.reply?.sentAt).toBe(2000);
    const later = randomRow(random, "Someone Else", target.id);
    expect(receive(forged, target.id, later, 2500, 3000).outcome.kind).toBe("received");
  });

  it("starts a changed reply with no decisions, so a renewed objection shows again", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row } = scenario(seed);
      const first = receive(state, target.id, row, 1500).state;
      const kept = settle(first, target.id, "mine");
      expect(review(rowOf(kept, target.id), kept.asks[target.id]).open).toEqual([]);
      const changed = { ...row, corresponding: !row.corresponding };
      const again = receive(kept, target.id, changed, 1600, 5000);
      const ask = again.state.asks[target.id];
      expect(ask?.reply?.decisions).toEqual({});
    }
  });

  it("takes the same answer under a newer send time as a duplicate, decisions kept", () => {
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row } = scenario(seed);
      const kept = settle(receive(state, target.id, row, 1500).state, target.id, "mine");
      const again = receive(kept, target.id, { ...row, name: rowOf(kept, target.id).name }, 1600, 5000);
      expect(again.outcome).toMatchObject({ kind: "received", duplicate: true });
      expect(again.state).toEqual(kept);
    }
  });

  it("takes the same answer to a newer ask as the answer, decisions kept", () => {
    const { state, target, row } = scenario(3);
    const kept = settle(receive(state, target.id, row, 1500, 2000).state, target.id, "mine");
    const reAsked = applyPatch(
      kept,
      askStep(kept, { kind: "sent", contributorId: target.id, prefilled: true, at: 3000 }).patch,
    );
    const again = receive(reAsked, target.id, { ...row, name: target.name }, 3500, 4000);
    expect(again.outcome).toMatchObject({ kind: "received", duplicate: false });
    const reply = again.state.asks[target.id]?.reply;
    expect(reply?.receivedAt).toBe(4000);
    expect(reply?.decisions).toEqual(kept.asks[target.id]?.reply?.decisions);
  });

  it("keeps a structured surname when the reply carries the same name", () => {
    const lead = createAuthor("Anne van der Berg", {
      id: "anne",
      firstName: "Anne",
      middleName: "",
      surname: "van der Berg",
    });
    const state: AskState = { authors: [lead], asks: { anne: { sentAt: 1, prefilled: true } } };
    // The co-author's app re-parsed the name: surname "Berg", "van der" as middle names.
    const row = createAuthor("Anne van der Berg", { id: "anne" });
    expect(row.surname).not.toBe("van der Berg");
    const { patch, state: next } = receive(state, "anne", row, 5);
    expect(patch.rows).toEqual({});
    expect(rowOf(next, "anne")).toBe(lead);
  });

  it("re-derives the name parts from a new name, and undo puts the structured ones back", () => {
    const lead = createAuthor("Anne van der Berg", {
      id: "anne",
      firstName: "Anne",
      middleName: "",
      surname: "van der Berg",
    });
    const state: AskState = { authors: [lead], asks: {} };
    const { undo, state: renamed } = receive(state, "anne", createAuthor("Anne Smith", { id: "anne" }), 5);
    expect(rowOf(renamed, "anne")).toMatchObject({ name: "Anne Smith", surname: "Smith", initials: "AS" });
    const back = rowOf(applyPatch(renamed, undo), "anne");
    expect(back).toMatchObject({ name: lead.name, surname: "van der Berg", initials: lead.initials });
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

function settle(state: AskState, id: string, choices: Choice | Partial<Record<Target, Choice | null>>): AskState {
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

  it("dates a settled answer by its last decision, or by its arrival when it needed none", () => {
    const { state, target, row } = scenario(1);
    const received = receive(state, target.id, row, 1500, 2000).state;
    const reply = received.asks[target.id]?.reply;
    if (!reply) throw new Error("expected a reply");
    expect(settledAt(reply)).toBe(2000);
    const step = askStep(received, { kind: "settle", contributorId: target.id, choices: "mine", at: 9000 });
    const decided = applyPatch(received, step.patch).asks[target.id]?.reply;
    if (!decided) throw new Error("expected a reply");
    expect(ASK_TARGETS.every((t) => decided.decisions[t] === undefined || decided.decisions[t]?.at === 9000)).toBe(
      true,
    );
    expect(settledAt(decided)).toBe(Object.keys(decided.decisions).length > 0 ? 9000 : 2000);
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

  it("clearing a decision reopens it and puts back the row's value a 'theirs' took", () => {
    const valueIn = (row: Author, target: Target) =>
      target === "equalContribution" || target === "corresponding"
        ? row[target]
        : Math.max(0, ...row.contributions.filter((c) => c.role === target).map((c) => c.score));
    for (let seed = 1; seed <= ROUNDS; seed++) {
      const { state, target, row, random } = scenario(seed);
      const received = receive(state, target.id, row, 1500).state;
      const open = review(rowOf(received, target.id), received.asks[target.id]).open;
      const choices = Object.fromEntries(open.map((d) => [d.target, random() < 0.5 ? "theirs" : "mine"]));
      const decided = settle(received, target.id, choices);
      // Clear every decision at once, or one at a time: the result is the same.
      const cleared = Object.fromEntries(open.map((d) => [d.target, null]));
      const undone =
        random() < 0.5
          ? settle(decided, target.id, cleared)
          : open.reduce((acc, d) => settle(acc, target.id, { [d.target]: null }), decided);
      const before = rowOf(received, target.id);
      const after = rowOf(undone, target.id);
      for (const d of open) expect(valueIn(after, d.target)).toEqual(valueIn(before, d.target));
      expect(undone.asks[target.id]?.reply?.decisions).toEqual({});
      expect(review(after, undone.asks[target.id]).open).toEqual(open);
    }
  });

  it("clearing a 'theirs' leaves a row edited since alone, and ignores targets with no decision", () => {
    const ada = createAuthor("Ada Lovelace", { id: "ada" });
    const state: AskState = { authors: [ada], asks: { ada: { sentAt: 1, prefilled: false } } };
    const reply = createAuthor("Ada Lovelace", { id: "ada", contributions: [{ role: "Software", score: 50 }] });
    const taken = settle(receive(state, "ada", reply, 10).state, "ada", { Software: "theirs" });
    expect(askStep(taken, { kind: "settle", contributorId: "ada", choices: { Methodology: null } }).patch).toEqual({
      rows: {},
      asks: {},
    });
    const edited: AskState = {
      ...taken,
      authors: [{ ...rowOf(taken, "ada"), contributions: [{ role: "Software", score: 100 }] }],
    };
    const cleared = settle(edited, "ada", { Software: null });
    expect(rowOf(cleared, "ada").contributions).toEqual([{ role: "Software", score: 100 }]);
    expect(cleared.asks.ada?.reply?.decisions).toEqual({});
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

  it.each([
    // JSON.parse makes "__proto__" an own key; an object literal would set the prototype instead.
    ["an unknown target (__proto__)", () => JSON.parse('{"__proto__":"theirs"}')],
    ["an unknown target (Bogus)", () => ({ Bogus: "theirs" })],
    ["a bad choice", () => ({ Software: "garbage" })],
    ["theirs for a target with no difference", () => ({ Methodology: "theirs" })],
  ])("writes nothing for %s", (_, choices) => {
    const ada = createAuthor("Ada Lovelace", { id: "ada" });
    const reply = createAuthor("Ada Lovelace", { id: "ada", contributions: [{ role: "Software", score: 100 }] });
    const received = receive({ authors: [ada], asks: { ada: { sentAt: 1, prefilled: false } } }, "ada", reply, 1).state;
    const decisions = received.asks.ada?.reply?.decisions;

    const step = askStep(received, { kind: "settle", contributorId: "ada", choices: choices() });

    expect(step.outcome).toEqual({ kind: "settled", open: 1 });
    expect(step.patch).toEqual({ rows: {}, asks: {} });
    expect(applyPatch(received, step.patch).asks.ada?.reply?.decisions).toBe(decisions);
  });
});

describe("askStep reply with a malformed row", () => {
  const ada = createAuthor("Ada Lovelace", { id: "ada" });
  const state: AskState = { authors: [ada], asks: { ada: { sentAt: 1, prefilled: false } } };
  const row = (patch: Record<string, unknown>) => ({ ...createAuthor("Ada Lovelace", { id: "ada" }), ...patch });

  it.each([
    ["a score over 100", row({ contributions: [{ role: "Software", score: 101 }] }), "broken"],
    ["a NaN score", row({ contributions: [{ role: "Software", score: Number.NaN }] }), "broken"],
    ["an unknown role", row({ contributions: [{ role: "Astrology", score: 100 }] }), "broken"],
    ["contributions that are not an array", row({ contributions: { Software: 100 } }), "broken"],
    ["a name past the length limit", row({ name: "A".repeat(501) }), "broken"],
    ["another contributor's row", row({ id: "bob" }), "broken"],
    ["a row for nobody in the roster", { ...row({ id: "bob" }) }, "unmatched", "bob"],
  ])("reads %s as %s, with nothing to write", (_, payload, kind, contributorId = "ada") => {
    let step: ReturnType<typeof askStep> | undefined;
    expect(() => {
      step = askStep(state, { kind: "reply", contributorId, row: payload, sentAt: 2, at: 3 });
    }).not.toThrow();
    expect(step?.outcome.kind).toBe(kind);
    expect(step?.patch).toEqual({ rows: {}, asks: {} });
    expect(step?.undo).toEqual({ rows: {}, asks: {} });
  });

  it("takes a repeated role at its highest score", () => {
    const payload = row({
      contributions: [
        { role: "Software", score: 20 },
        { role: "Software", score: 100 },
      ],
    });
    const { outcome, state: next } = receive(state, "ada", payload as Author, 2);
    expect(outcome.kind).toBe("received");
    expect(review(rowOf(next, "ada"), next.asks.ada).byTarget.Software?.theirs).toBe("lead");
  });
});

describe("askStep reply with the same send time", () => {
  const ada = createAuthor("Ada Lovelace", { id: "ada" });
  const first = createAuthor("Ada Lovelace", { id: "ada", contributions: [{ role: "Software", score: 100 }] });
  const received = receive({ authors: [ada], asks: { ada: { sentAt: 1, prefilled: false } } }, "ada", first, 5).state;

  it("is a duplicate when the answer is the same", () => {
    const step = askStep(received, { kind: "reply", contributorId: "ada", row: first, sentAt: 5, at: 9 });
    expect(step.outcome).toEqual({ kind: "received", open: 1, duplicate: true });
    expect(step.patch).toEqual({ rows: {}, asks: {} });
  });

  it("replaces the answer when it changed, as the later word from the same link", () => {
    const changed = createAuthor("Ada Lovelace", { id: "ada", contributions: [{ role: "Methodology", score: 100 }] });
    const step = askStep(received, { kind: "reply", contributorId: "ada", row: changed, sentAt: 5, at: 9 });
    expect(step.outcome).toEqual({ kind: "received", open: 1, duplicate: false });
    expect(step.patch.asks.ada?.reply?.receivedAt).toBe(9);
  });
});

describe("askStep sent", () => {
  it("a re-ask keeps the last answer and shows the row as asked", () => {
    const { state, target, row } = scenario(11);
    const received = receive(state, target.id, row, 1500).state;
    const step = askStep(received, { kind: "sent", contributorId: target.id, prefilled: true, at: 9000 });
    const asked = applyPatch(received, step.patch);
    expect(asked.asks[target.id]?.reply).toEqual(received.asks[target.id]?.reply);
    expect(review(rowOf(asked, target.id), asked.asks[target.id]).status).toEqual({ kind: "asked", prefilled: true });
    expect(applyPatch(asked, step.undo).asks).toEqual(received.asks);
  });

  it("a late undo never brings back an ask for a row that is gone", () => {
    const { state, target, row } = scenario(5);
    const { undo, state: received } = receive(state, target.id, row, 1500);
    const without: AskState = {
      authors: received.authors.filter((author) => author.id !== target.id),
      asks: {},
    };
    expect(applyPatch(without, undo).asks).toEqual({});
  });
});

describe("applyPatch", () => {
  it("keeps every row it does not change the same object, so review stays cached", () => {
    const { state, target, row } = scenario(4);
    const received = receive(state, target.id, { ...row, name: target.name }, 1500).state;
    const settled = settle(received, target.id, "theirs");
    for (const author of settled.authors) {
      if (author.id !== target.id) expect(author).toBe(rowOf(state, author.id));
    }
    const reAsked = applyPatch(
      settled,
      askStep(settled, { kind: "sent", contributorId: target.id, prefilled: true, at: 9 }).patch,
    );
    expect(reAsked.authors).toBe(settled.authors);
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

  it("keeps a decision on a target a later release adds, and ignores it", () => {
    const { state, target, row } = scenario(9);
    const received = receive(state, target.id, row, 1500, 2000).state;
    const ask = received.asks[target.id] as Ask;
    const future = { ...ask, reply: { ...ask.reply, decisions: { preprint: { choice: "theirs", at: 99_999 } } } };
    const read = fromJson(toJson(received.authors as Author[], { asks: { [target.id]: future as Ask } }));
    const reply = read.asks?.[target.id]?.reply;
    expect(reply?.decisions).toEqual({ preprint: { choice: "theirs", at: 99_999 } });
    if (!reply) throw new Error("expected a reply");
    expect(settledAt(reply)).toBe(2000);
    const author = rowOf(received, target.id);
    expect(review(author, read.asks?.[target.id]).open).toEqual(review(author, ask).open);
  });

  it("says who made the file, while that row is in it", () => {
    const authors = scenario(9).state.authors as Author[];
    const self = authors[0]?.id;
    expect(JSON.parse(toJson(authors, { selfId: self })).selfId).toBe(self);
    expect(JSON.parse(toJson(authors, { selfId: "gone" }))).not.toHaveProperty("selfId");
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

  it("reads back who made the file, through the same id map as the answers", () => {
    const authors = scenario(9).state.authors as Author[];
    const self = authors[1]?.id;
    expect(fromJson(toJson(authors, { selfId: self })).selfId).toBe(self);
    expect(fromJson(toJson(authors))).not.toHaveProperty("selfId");

    const ada = createAuthor("Ada Lovelace", { id: "ada" });
    const incoming = [
      createAuthor("Ada Lovelace", { id: "file-ada" }),
      createAuthor("Grace Hopper", { id: "file-grace" }),
    ];
    const mapped = keepKnownIds([ada], incoming);
    expect(importSelfId([ada], incoming, mapped, "file-ada")).toBe("ada");
    // A row that matched nobody here is not you in this draft.
    expect(importSelfId([ada], incoming, mapped, "file-grace")).toBeUndefined();
    expect(importSelfId([ada], incoming, mapped, "nobody")).toBeUndefined();
    expect(importSelfId([ada], incoming, mapped, undefined)).toBeUndefined();
    expect(importSelfId([], incoming, incoming, "file-grace")).toBe("file-grace");
  });
});
