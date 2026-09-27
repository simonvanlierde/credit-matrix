import { z } from "zod";
import type { Author } from "./author";
import { clampScore, MAX_AUTHORS } from "./author";
import { CREDIT_ROLES } from "./credit-roles";
import { createAuthor, deduplicateAuthorInitials } from "./parse-authors";

const ID_REGEX = /^[\w-]{1,64}$/;

/**
 * A draft squeezed small enough to travel in a URL.
 *
 * The JSON export repeats all fourteen role names for every contributor, which
 * is roughly nine tenths of its bytes and puts a ten-author link past 18 kB —
 * fine in a browser, but long enough that mail clients start wrapping it. Here
 * the scores are positional, in `CREDIT_ROLES` order, and every key is one
 * character. The same ten authors come out near 1.7 kB.
 *
 * Names are the only thing that cannot be shortened, so they are the floor.
 *
 * v2 adds the envelope this link needs beyond the author matrix: a title, and
 * the claim/reply/source-draft triangle that lets a claim link round-trip back
 * to the draft it came from and be told apart from the reply the claimee sends.
 */
const SharePayloadSchema = z
  .object({
    /** Payload version. v2 carries ids and the envelope; nothing older decodes. */
    v: z.literal(2),
    /** draft title */
    t: z.string().max(500).optional(),
    /** source draft id */
    d: z.string().regex(ID_REGEX).optional(),
    /** claimed contributor id */
    c: z.string().regex(ID_REGEX).optional(),
    /** reply flag: set on the link a claimee sends back */
    r: z.literal(1).optional(),
    a: z
      .array(
        z.object({
          /** stable contributor id */
          i: z.string().regex(ID_REGEX),
          /** name */
          n: z.string(),
          /** ORCID iD, omitted when there is none */
          o: z.string().optional(),
          /** 1 for a non-author contributor; omitted for a named author */
          t: z.literal(1).optional(),
          /** scores, in CREDIT_ROLES order */
          s: z.array(z.number()),
          /** shares first authorship */
          e: z.literal(1).optional(),
          /** corresponding author */
          c: z.literal(1).optional(),
        }),
      )
      .max(MAX_AUTHORS),
  })
  .superRefine((payload, ctx) => {
    // A claim needs a home to reply to, and a reply is always a claim.
    if (payload.c && !payload.d) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "claim without source draft" });
    if (payload.r && !payload.c) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reply without claim" });
    if (payload.c && !payload.a.some((entry) => entry.i === payload.c)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "claim names an absent contributor" });
    }
    if (new Set(payload.a.map((entry) => entry.i)).size !== payload.a.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate contributor ids" });
    }
  });

/** Decoded share link: the author matrix plus the envelope it travelled with. */
export interface ShareData {
  authors: Author[];
  /** "" when the payload carries none */
  title: string;
  /** contributor id the link is addressed to */
  claimId: string | null;
  /** always non-null when claimId is non-null */
  sourceDraftId: string | null;
  reply: boolean;
}

export interface SharePayloadInput {
  authors: Author[];
  title?: string;
  claimId?: string;
  sourceDraftId?: string;
  reply?: boolean;
}

/** Serialize authors and envelope into the compact share shape. Minified, never pretty. */
export function toSharePayload(input: SharePayloadInput): string {
  const { title, claimId, sourceDraftId, reply } = input;
  // A claim link is addressed to one person and travels through their mail:
  // it carries their own row and nobody else's names, iDs, or scores. The
  // reply comes back the same way, and the merge only ever takes that row.
  const authors = claimId ? input.authors.filter((author) => author.id === claimId) : input.authors;

  const scoreByRole = (author: Author) => {
    const scores = new Map(author.contributions.map((contribution) => [contribution.role, contribution.score]));
    return CREDIT_ROLES.map((role) => scores.get(role.name) ?? 0);
  };

  return JSON.stringify({
    v: 2,
    ...(title?.trim() ? { t: title.trim().slice(0, 500) } : {}),
    ...(sourceDraftId ? { d: sourceDraftId } : {}),
    ...(claimId ? { c: claimId } : {}),
    ...(reply ? { r: 1 } : {}),
    a: authors.map((author) => ({
      i: author.id,
      n: author.name,
      ...(author.orcid ? { o: author.orcid } : {}),
      ...(author.contributorType === "non-author" ? { t: 1 } : {}),
      s: scoreByRole(author),
      ...(author.equalContribution ? { e: 1 } : {}),
      ...(author.corresponding ? { c: 1 } : {}),
    })),
  });
}

/**
 * Read the compact share shape. Throws on anything else, which the caller
 * turns into "that link could not be opened".
 */
export function fromSharePayload(json: string): ShareData {
  const payload = SharePayloadSchema.parse(JSON.parse(json));
  const authors = deduplicateAuthorInitials(
    payload.a.map((entry) =>
      createAuthor(entry.n, {
        id: entry.i,
        ...(entry.o ? { orcid: entry.o } : {}),
        contributorType: entry.t === 1 ? "non-author" : "author",
        contributions: CREDIT_ROLES.map((role, index) => ({
          role: role.name,
          // A payload from a build with fewer roles simply has a shorter array;
          // the roles it did not know about read as unassigned.
          score: clampScore(entry.s[index] ?? 0),
        })),
        equalContribution: entry.e === 1,
        corresponding: entry.c === 1,
      }),
    ),
  );

  return {
    authors,
    title: payload.t ?? "",
    claimId: payload.c ?? null,
    sourceDraftId: payload.d ?? null,
    reply: payload.r === 1,
  };
}
