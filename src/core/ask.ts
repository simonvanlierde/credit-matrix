import * as z from "zod/mini";
import type { Author, Contribution, ContributionLevel } from "./author";
import { AuthorSchema, ContributionSchema, scoreToLevel } from "./author";
import type { CreditRoleName } from "./credit-roles";
import { CREDIT_ROLES } from "./credit-roles";
import { createAuthor, deduplicateAuthorInitials } from "./parse-authors";

/** What a reply answers: each role, and the two markers outside CRediT. */
export type Target = CreditRoleName | "equalContribution" | "corresponding";
export type Choice = "theirs" | "mine";
/** A role's level, or whether a marker is set. Differences compare these, never raw scores. */
export type Level = ContributionLevel | boolean;

const MARKERS = ["equalContribution", "corresponding"] as const;
type Marker = (typeof MARKERS)[number];
/** Roles in CREDIT_ROLES order, then the two markers: the order `review().open` lists them in. */
export const ASK_TARGETS: readonly Target[] = [...CREDIT_ROLES.map((role) => role.name), ...MARKERS];

const isMarker = (target: Target): target is Marker => target === "equalContribution" || target === "corresponding";

const DecisionSchema = z.object({
  choice: z.enum(["theirs", "mine"]),
  /** The row's level when the decision was made; a later edit to the row reopens it. */
  rowLevel: z.union([z.enum(["none", "supporting", "equal", "lead"]), z.boolean()]),
  /** When it was made, in epoch milliseconds. Absent on decisions from before it was kept. */
  at: z.optional(z.number()),
  /** On "theirs": the row's exact score, or marker, before their answer replaced it. Clearing the decision puts it back. */
  before: z.optional(z.union([z.number(), z.boolean()])),
});
export type Decision = z.infer<typeof DecisionSchema>;

// Loose: keys a later release adds (a reply's provenance) survive a round trip through this one.
const ReplySchema = z.looseObject({
  contributions: z.array(ContributionSchema),
  equalContribution: z.boolean(),
  corresponding: z.boolean(),
  /** When the co-author sent it (the link's `w`), or when it was opened for links without one. */
  sentAt: z.number(),
  receivedAt: z.number(),
  decisions: z.partialRecord(z.enum(ASK_TARGETS as [Target, ...Target[]]), DecisionSchema),
});
export type Reply = z.infer<typeof ReplySchema>;

/** One contributor's ask and their latest answer. Validates stored and imported asks. */
export const AskSchema = z.looseObject({
  /** When the ask link was copied, in epoch milliseconds. */
  sentAt: z.number(),
  /** Whether the link carried the asker's guess, or an empty row. */
  prefilled: z.boolean(),
  reply: z.optional(ReplySchema),
});
export type Ask = z.infer<typeof AskSchema>;

export interface AskState {
  authors: readonly Author[];
  asks: Readonly<Record<string, Ask>>;
}

/**
 * Changes to apply. A row entry holds only the fields that change, merged onto
 * the row as it is when the patch is applied, so undoing a reply restores the
 * identity fields and leaves scores edited since then alone. `null` deletes an ask.
 */
export interface Patch {
  rows: Record<string, Partial<Author>>;
  asks: Record<string, Ask | null>;
}

export type AskEvent =
  | { kind: "sent"; contributorId: string; prefilled: boolean; at: number }
  | { kind: "reply"; contributorId: string; row: unknown; sentAt: number | null; at: number }
  /** A `null` choice clears that target's decision, and a "theirs" one puts the row's value back. */
  | { kind: "settle"; contributorId: string; choices: Choice | Partial<Record<Target, Choice | null>>; at?: number }
  | { kind: "removed"; contributorId: string };

export type Outcome =
  | { kind: "recorded" }
  | { kind: "received"; open: number; duplicate: boolean }
  | { kind: "settled"; open: number }
  | { kind: "unmatched" }
  | { kind: "broken" }
  | { kind: "stale" }
  | { kind: "noReply" };

export interface Difference {
  target: Target;
  /** "added": they claim what you left empty; "dropped": the reverse; "level": both set, levels differ. */
  kind: "added" | "dropped" | "level";
  mine: Level;
  theirs: Level;
}

export interface Review {
  status:
    | { kind: "none" }
    | { kind: "asked"; prefilled: boolean }
    | { kind: "differs"; count: number }
    | { kind: "settled" };
  /** Every target where the levels differ, decided or not. */
  byTarget: Partial<Record<Target, Difference>>;
  /** The differences still waiting for a decision, in `ASK_TARGETS` order. */
  open: Difference[];
}

type Answer = Pick<Author, "contributions" | "equalContribution" | "corresponding">;

const IDENTITY = ["name", "firstName", "middleName", "surname", "orcid", "contributorType"] as const;

const emptyPatch = (): Patch => ({ rows: {}, asks: {} });
const nothing = (kind: "unmatched" | "broken" | "stale" | "noReply") => ({
  outcome: { kind } as Outcome,
  patch: emptyPatch(),
  undo: emptyPatch(),
});

function scoreOf(answer: Answer, role: CreditRoleName): number {
  // An imported row may repeat a role; the highest score is the one that counts (see AuthorSchema).
  let score = 0;
  for (const contribution of answer.contributions)
    if (contribution.role === role) score = Math.max(score, contribution.score);
  return score;
}

function levelOf(answer: Answer, target: Target): Level {
  return isMarker(target) ? answer[target] === true : scoreToLevel(scoreOf(answer, target));
}

const isUnset = (level: Level) => level === "none" || level === false;

function sameAnswer(a: Answer, b: Answer): boolean {
  return ASK_TARGETS.every((target) =>
    isMarker(target) ? a[target] === b[target] : scoreOf(a, target) === scoreOf(b, target),
  );
}

const reviews = new WeakMap<Author, WeakMap<object, Review>>();
const NO_ASK = {};

/**
 * Everything a row, cell, review list or notice shows about one contributor's
 * ask. Cached per (author, ask) object pair, so state must be replaced, never
 * mutated in place.
 */
export function review(author: Author, ask?: Ask): Review {
  let byAsk = reviews.get(author);
  if (!byAsk) {
    byAsk = new WeakMap();
    reviews.set(author, byAsk);
  }
  const cached = byAsk.get(ask ?? NO_ASK);
  if (cached) return cached;
  const result = computeReview(author, ask);
  byAsk.set(ask ?? NO_ASK, result);
  return result;
}

function computeReview(author: Author, ask?: Ask): Review {
  if (!ask) return { status: { kind: "none" }, byTarget: {}, open: [] };
  const reply = ask.reply;
  if (!reply) return { status: { kind: "asked", prefilled: ask.prefilled }, byTarget: {}, open: [] };

  const byTarget: Partial<Record<Target, Difference>> = {};
  const open: Difference[] = [];
  for (const target of ASK_TARGETS) {
    const mine = levelOf(author, target);
    const theirs = levelOf(reply, target);
    if (mine === theirs) continue;
    const kind = isUnset(mine) ? "added" : isUnset(theirs) ? "dropped" : "level";
    const difference: Difference = { target, kind, mine, theirs };
    byTarget[target] = difference;
    // A decision holds only while the row still has the level it was made against.
    const decision = reply.decisions[target];
    if (!decision || decision.rowLevel !== mine) open.push(difference);
  }
  // Asked again since this answer arrived: the row waits for the next one.
  const status: Review["status"] =
    ask.sentAt > reply.receivedAt
      ? { kind: "asked", prefilled: ask.prefilled }
      : open.length > 0
        ? { kind: "differs", count: open.length }
        : { kind: "settled" };
  return { status, byTarget, open };
}

/**
 * Every change to asks and replies. Pure: time comes in on the event. Never
 * throws on outside input; a `reply` event's row is untrusted.
 */
export function askStep(state: AskState, event: AskEvent): { outcome: Outcome; patch: Patch; undo: Patch } {
  const id = event.contributorId;
  const held = state.asks[id];
  const author = state.authors.find((candidate) => candidate.id === id);

  switch (event.kind) {
    case "removed":
      if (!held) return { outcome: { kind: "recorded" }, patch: emptyPatch(), undo: emptyPatch() };
      return {
        outcome: { kind: "recorded" },
        patch: { rows: {}, asks: { [id]: null } },
        undo: { rows: {}, asks: { [id]: held } },
      };

    case "sent": {
      if (!author) return nothing("unmatched");
      // A re-ask keeps the last answer: it stays the record until a newer one replaces it.
      const ask: Ask = { ...held, sentAt: event.at, prefilled: event.prefilled };
      return {
        outcome: { kind: "recorded" },
        patch: { rows: {}, asks: { [id]: ask } },
        undo: { rows: {}, asks: { [id]: held ?? null } },
      };
    }

    case "reply": {
      const parsed = AuthorSchema.safeParse(event.row);
      if (!parsed.success || parsed.data.id !== id) return nothing("broken");
      if (!author) return nothing("unmatched");
      const row = parsed.data;
      // A link from before send times were recorded counts as sent when opened.
      const sentAt = event.sentAt ?? event.at;
      const answer: Answer = {
        contributions: row.contributions,
        equalContribution: row.equalContribution,
        corresponding: row.corresponding,
      };
      if (held?.reply) {
        if (sentAt < held.reply.sentAt) return nothing("stale");
        const sameLink = event.sentAt === null || sentAt === held.reply.sentAt;
        if (sameLink && sameAnswer(held.reply, answer)) {
          return {
            outcome: { kind: "received", open: review(author, held).open.length, duplicate: true },
            patch: emptyPatch(),
            undo: emptyPatch(),
          };
        }
      }
      // A newer reply starts with no decisions, so a renewed objection shows again.
      const reply: Reply = { ...answer, sentAt, receivedAt: event.at, decisions: {} };
      // A reply with no recorded ask (asked before asks were kept, or the ask was undone): every such ask was pre-filled.
      const ask: Ask = { ...(held ?? { sentAt: 0, prefilled: true }), reply };

      const identity: Partial<Author> = {};
      const previous: Partial<Author> = {};
      for (const field of IDENTITY) {
        if (row[field] === author[field]) continue;
        Object.assign(identity, { [field]: row[field] });
        Object.assign(previous, { [field]: author[field] });
      }
      const changed = Object.keys(identity).length > 0;
      return {
        outcome: { kind: "received", open: review({ ...author, ...identity }, ask).open.length, duplicate: false },
        patch: { rows: changed ? { [id]: identity } : {}, asks: { [id]: ask } },
        undo: { rows: changed ? { [id]: previous } : {}, asks: { [id]: held ?? null } },
      };
    }

    case "settle": {
      if (!author) return nothing("unmatched");
      const reply = held?.reply;
      if (!(held && reply)) return nothing("noReply");
      const current = review(author, held);
      const picks: [Target, Choice | null][] =
        typeof event.choices === "string"
          ? current.open.map((difference) => [difference.target, event.choices as Choice])
          : (Object.entries(event.choices) as [Target, Choice | null][]).filter(([target, choice]) =>
              choice === null
                ? Object.hasOwn(reply.decisions, target)
                : Object.hasOwn(current.byTarget, target) && (choice === "theirs" || choice === "mine"),
            );

      const next: Answer = {
        contributions: author.contributions.map((contribution) => ({ ...contribution })),
        equalContribution: author.equalContribution,
        corresponding: author.corresponding,
      };
      const decisions = { ...reply.decisions };
      for (const [target, choice] of picks) {
        if (choice === null) {
          const decision = decisions[target];
          delete decisions[target];
          // Only a row still as the decision left it goes back: a later edit is the lead's own.
          if (decision?.before !== undefined && levelOf(next, target) === decision.rowLevel) {
            setValue(next, target, decision.before);
          }
          continue;
        }
        const before = exactValue(next, target);
        if (choice === "theirs") setValue(next, target, exactValue(reply, target));
        decisions[target] = {
          choice,
          rowLevel: levelOf(next, target),
          ...(event.at === undefined ? {} : { at: event.at }),
          ...(choice === "theirs" ? { before } : {}),
        };
      }
      const ask: Ask = { ...held, reply: { ...reply, decisions } };
      const rowChanged = !sameAnswer(author, next);
      return {
        outcome: { kind: "settled", open: review({ ...author, ...next }, ask).open.length },
        patch: { rows: rowChanged ? { [id]: next } : {}, asks: { [id]: ask } },
        undo: {
          rows: rowChanged
            ? {
                [id]: {
                  contributions: author.contributions,
                  equalContribution: author.equalContribution,
                  corresponding: author.corresponding,
                },
              }
            : {},
          asks: { [id]: held },
        },
      };
    }
  }
}

/** When the answer was settled: its last decision, or its arrival when nothing needed one. */
export function settledAt(reply: Reply): number {
  let at = reply.receivedAt;
  for (const decision of Object.values(reply.decisions)) if (decision?.at && decision.at > at) at = decision.at;
  return at;
}

/** The exact score, or the marker, a row holds for a target. */
function exactValue(answer: Answer, target: Target): number | boolean {
  return isMarker(target) ? answer[target] === true : scoreOf(answer, target);
}

/** Write an exact score or marker into the row. */
function setValue(row: Answer, target: Target, value: number | boolean): void {
  if (isMarker(target)) {
    row[target] = value === true;
    return;
  }
  const score = Number(value);
  const existing = row.contributions.filter((contribution) => contribution.role === target);
  if (existing.length === 0) row.contributions.push({ role: target, score } satisfies Contribution);
  for (const contribution of existing) contribution.score = score;
}

/**
 * Apply a patch to plain values. Rows a patch names but the roster no longer
 * holds are skipped. Initials are re-derived, since a rename can change them.
 */
export function applyPatch(state: AskState, patch: Patch): AskState {
  let renamed = false;
  const authors = state.authors.map((author) => {
    const fields = patch.rows[author.id];
    if (!fields) return author;
    const merged = { ...author, ...fields };
    if (fields.name === undefined) return merged;
    renamed = true;
    return createAuthor(merged.name, merged);
  });
  const asks = { ...state.asks };
  for (const [id, ask] of Object.entries(patch.asks)) {
    if (ask === null) delete asks[id];
    else asks[id] = ask;
  }
  return { authors: renamed ? deduplicateAuthorInitials(authors) : authors, asks };
}

/**
 * The answers an imported file brings, keyed by the ids the imported roster
 * takes (`mapped` is `keepKnownIds(current, incoming)`, index for index).
 * Importing into a draft that has contributors, a file's answer replaces the
 * held one for the row it matched, and answers for rows that matched nobody
 * are dropped. Held answers for matched rows the file has none for are kept.
 */
export function importAsks(
  current: readonly Author[],
  incoming: readonly Author[],
  mapped: readonly Author[],
  held: Readonly<Record<string, Ask>>,
  fromFile: Readonly<Record<string, Ask>>,
): Record<string, Ask> {
  const known = new Set(current.map((author) => author.id));
  const asks: Record<string, Ask> = {};
  incoming.forEach((author, index) => {
    const id = mapped[index]?.id;
    if (!id) return;
    const filed = Object.hasOwn(fromFile, author.id) ? fromFile[author.id] : undefined;
    const kept = Object.hasOwn(held, id) ? held[id] : undefined;
    const ask = filed && (known.size === 0 || known.has(id)) ? filed : kept;
    if (ask) asks[id] = ask;
  });
  return asks;
}

/**
 * The file's `selfId` under the id the imported roster gives that row, by the
 * same rule as `importAsks`: into a draft that has contributors, only a row
 * that matched one of them keeps it. Undefined when it does not survive.
 */
export function importSelfId(
  current: readonly Author[],
  incoming: readonly Author[],
  mapped: readonly Author[],
  selfId: string | undefined,
): string | undefined {
  const id = mapped[incoming.findIndex((author) => author.id === selfId)]?.id;
  if (!id) return undefined;
  return current.length === 0 || current.some((author) => author.id === id) ? id : undefined;
}
