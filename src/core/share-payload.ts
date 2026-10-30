import * as z from "zod/mini";
import type { Author } from "./author";
import { clampScore, isShareableId, MAX_AUTHORS } from "./author";
import { CREDIT_ROLES } from "./credit-roles";
import { createAuthor, deduplicateAuthorInitials } from "./parse-authors";

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
 * Keys added since are optional, so a reader that predates them ignores them.
 */
/** An ORCID id_token is under 1 kB; the cap only keeps junk out. */
const MAX_TOKEN_LENGTH = 4096;

const SharePayloadSchema = /* @__PURE__ */ (() =>
  z
    .object({
      /** Payload version. v2 carries ids and the envelope; nothing older decodes. */
      v: z.literal(2),
      /** draft title */
      t: z.optional(z.string().check(z.maxLength(500))),
      /** source draft id */
      d: z.optional(z.string().check(z.refine(isShareableId))),
      /** claimed contributor id */
      c: z.optional(z.string().check(z.refine(isShareableId))),
      /** reply flag: set on the link a claimee sends back */
      r: z.optional(z.literal(1)),
      /** blank ask: the claimed row was sent with its scores zeroed */
      b: z.optional(z.literal(1)),
      /** when the link was sent, in epoch milliseconds; written now so a later release can order replies */
      w: z.optional(z.number().check(z.nonnegative())),
      /** the asker works in yes/no mode, so the co-author answers yes or no rather than in levels */
      y: z.optional(z.literal(1)),
      /** ORCID id_token on a signed-in reply; always the last key, its nonce hashes the payload without it */
      k: z.optional(z.string().check(z.maxLength(MAX_TOKEN_LENGTH))),
      a: z
        .array(
          z.object({
            /** stable contributor id */
            i: z.string().check(z.refine(isShareableId)),
            /** name */
            n: z.string(),
            /** ORCID iD, omitted when there is none */
            o: z.optional(z.string()),
            /** 1 for a non-author contributor; omitted for a named author */
            t: z.optional(z.literal(1)),
            /** scores, in CREDIT_ROLES order */
            s: z.array(z.number()),
            /** shares first authorship */
            e: z.optional(z.literal(1)),
            /** corresponding author */
            c: z.optional(z.literal(1)),
          }),
        )
        .check(z.maxLength(MAX_AUTHORS)),
    })
    .check(
      z.superRefine((payload, ctx) => {
        // A claim needs a home to reply to, and a reply is always a claim.
        if (payload.c && !payload.d) ctx.addIssue({ code: "custom", message: "claim without source draft" });
        if (payload.r && !payload.c) ctx.addIssue({ code: "custom", message: "reply without claim" });
        if (payload.k && !payload.r) ctx.addIssue({ code: "custom", message: "sign-in on a link that is not a reply" });
        if (payload.c && !payload.a.some((entry) => entry.i === payload.c)) {
          ctx.addIssue({ code: "custom", message: "claim names an absent contributor" });
        }
        if (new Set(payload.a.map((entry) => entry.i)).size !== payload.a.length) {
          ctx.addIssue({ code: "custom", message: "duplicate contributor ids" });
        }
      }),
    ))();

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
  /** an ask sent without the asker's guess */
  blank: boolean;
  /** when the link was sent; null on links from before this was recorded */
  sentAt: number | null;
  /** the asker works in yes/no mode; false on links from before this was recorded */
  yesNo: boolean;
  /**
   * A reply's ORCID sign-in, unchecked: the token and the payload its nonce must hash. Check it with
   * `verifyOrcidToken(token, { payload, keys })`, keys from `fetchOrcidKeys()`, before passing it on.
   */
  signIn: { token: string; payload: string } | null;
}

export interface SharePayloadInput {
  authors: Author[];
  title?: string;
  claimId?: string;
  sourceDraftId?: string;
  reply?: boolean;
  /** Send the claimed row with its scores zeroed. Only meaningful with `claimId`. */
  blank?: boolean;
  sentAt?: number;
  /** The asker works in yes/no mode. Only meaningful with `claimId`. */
  yesNo?: boolean;
  /** The co-author's ORCID id_token, issued for this payload without it. Only meaningful with `reply`. */
  idToken?: string;
}

/** Serialize authors and envelope into the compact share shape. Minified, never pretty. */
export function toSharePayload(input: SharePayloadInput): string {
  const { title, claimId, sourceDraftId, reply, sentAt } = input;
  const blank = Boolean(input.blank && claimId);
  // A claim link is addressed to one person and travels through their mail:
  // it carries their own row and nobody else's names, iDs, or scores. The
  // reply comes back the same way, and the merge only ever takes that row.
  const authors = claimId ? input.authors.filter((author) => author.id === claimId) : input.authors;

  const scoreByRole = (author: Author) => {
    if (blank) return CREDIT_ROLES.map(() => 0);
    const scores = new Map(author.contributions.map((contribution) => [contribution.role, contribution.score]));
    return CREDIT_ROLES.map((role) => scores.get(role.name) ?? 0);
  };

  return JSON.stringify({
    v: 2,
    // Cut at 500 UTF-16 units, the schema's limit, without leaving half an emoji at the end.
    ...(title?.trim()
      ? {
          t: title
            .trim()
            .slice(0, 500)
            .replace(/[\uD800-\uDBFF]$/, ""),
        }
      : {}),
    ...(sourceDraftId ? { d: sourceDraftId } : {}),
    ...(claimId ? { c: claimId } : {}),
    ...(reply ? { r: 1 } : {}),
    ...(blank ? { b: 1 } : {}),
    ...(sentAt !== undefined ? { w: sentAt } : {}),
    ...(input.yesNo && claimId ? { y: 1 } : {}),
    a: authors.map((author) => ({
      i: author.id,
      n: author.name,
      ...(author.orcid ? { o: author.orcid } : {}),
      ...(author.contributorType === "non-author" ? { t: 1 } : {}),
      s: scoreByRole(author),
      ...(author.equalContribution ? { e: 1 } : {}),
      ...(author.corresponding ? { c: 1 } : {}),
    })),
    // Last, so dropping it gives back the exact payload the token's nonce hashes.
    ...(input.idToken && reply ? { k: input.idToken } : {}),
  });
}

/**
 * Read the compact share shape. Throws on anything else, which the caller
 * turns into "that link could not be opened".
 */
export function fromSharePayload(json: string): ShareData {
  const raw = JSON.parse(json);
  const payload = SharePayloadSchema.parse(raw);
  // Re-serializing JSON.stringify output gives the same string back, so this is what the co-author hashed.
  const { k: _token, ...signed } = raw;
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
    blank: payload.b === 1,
    sentAt: payload.w ?? null,
    yesNo: payload.y === 1,
    signIn: payload.k ? { token: payload.k, payload: JSON.stringify(signed) } : null,
  };
}
