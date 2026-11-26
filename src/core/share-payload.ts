import * as z from "zod/mini";
import type { Contributor, Person } from "./author";
import {
  clampScore,
  isGroup,
  isShareableId,
  MAX_AUTHOR_NAME_LENGTH,
  MAX_AUTHORS,
  MAX_GROUP_MEMBERS,
  MemberSchema,
} from "./author";
import { CREDIT_ROLES } from "./credit-roles";
import { createAuthor, createGroup, deduplicateAuthorInitials, parseNameParts } from "./parse-authors";

import { type Toolchain, ToolchainSchema } from "./toolchain";

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
 *
 * v3 adds group rows (`g`). A v2 link still decodes; this build writes v3, which a v2 reader refuses.
 */
/** An ORCID id_token is under 1 kB; the cap only keeps junk out. */
const MAX_TOKEN_LENGTH = 4096;

const namePart = () => z.string().check(z.maxLength(MAX_AUTHOR_NAME_LENGTH));

const SharePayloadSchema = /* @__PURE__ */ (() =>
  z
    .object({
      /** Payload version. v2 adds ids and the envelope, v3 groups; nothing older decodes. */
      v: z.union([z.literal(2), z.literal(3)]),
      /** draft title */
      t: z.optional(z.string().check(z.maxLength(500))),
      /** writing tool; one this build does not know is dropped in fromSharePayload, which says so */
      h: z.optional(z.unknown()),
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
            /** 1 for a group: no ORCID iD, name parts or markers, and the group keys below */
            g: z.optional(z.literal(1)),
            /** a group's alias */
            l: z.optional(z.string().check(z.maxLength(MAX_AUTHOR_NAME_LENGTH))),
            /** a group's ROR id, bare */
            r: z.optional(z.string()),
            /** a group's members; a name and, for a member tied to a person row, that row's id */
            m: z.optional(z.array(MemberSchema).check(z.maxLength(MAX_GROUP_MEMBERS))),
            /** 1 when a group's members are authors, omitted for collaborators */
            a: z.optional(z.literal(1)),
            /** a group's contact: the id of a member's person row */
            u: z.optional(z.string()),
            /** ORCID iD, omitted when there is none */
            o: z.optional(z.string()),
            /** first, middle and surname, omitted when parsing the name gives the same parts */
            p: z.optional(z.tuple([namePart(), namePart(), namePart()])),
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
  toolchain?: Toolchain;
  /** The link named a writing tool this build does not know, so `toolchain` left it out. */
  toolchainDropped?: true;
  authors: Contributor[];
  /** "" when the payload has none */
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
  toolchain?: Toolchain;
  authors: Contributor[];
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

/** Thrown by `toSharePayload` for input whose link `fromSharePayload` would reject. */
export class UnsharableDraftError extends Error {
  constructor(reason: string) {
    super(`This draft cannot be shared as a link: ${reason}.`);
    this.name = "UnsharableDraftError";
  }
}

/**
 * Serialize authors and envelope into the compact share shape. Minified, never pretty.
 * Throws an UnsharableDraftError rather than write a link its reader rejects: a
 * claim on a contributor not in `authors`, a claim without `sourceDraftId`, a
 * negative `sentAt`. Dropping the claim instead would send everyone's rows.
 */
export function toSharePayload(input: SharePayloadInput): string {
  const { title, claimId, sourceDraftId, reply, sentAt } = input;
  const blank = Boolean(input.blank && claimId);
  // A claim link is addressed to one person and travels through their mail:
  // it holds their own row and nobody else's names, iDs, or scores. The
  // reply comes back the same way, and the merge only ever takes that row.
  const authors = claimId ? input.authors.filter((author) => author.id === claimId) : input.authors;

  const scoreByRole = (author: Contributor) => {
    if (blank) return CREDIT_ROLES.map(() => 0);
    const scores = new Map(author.contributions.map((contribution) => [contribution.role, contribution.score]));
    return CREDIT_ROLES.map((role) => scores.get(role.name) ?? 0);
  };

  const payload = {
    v: 3,
    ...(input.toolchain ? { h: input.toolchain } : {}),
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
      ...(isGroup(author)
        ? {
            g: 1,
            ...(author.alias ? { l: author.alias } : {}),
            ...(author.ror ? { r: author.ror } : {}),
            ...(author.members.length > 0 ? { m: author.members } : {}),
            ...(author.membersAre === "authors" ? { a: 1 } : {}),
            ...(author.contactId ? { u: author.contactId } : {}),
          }
        : {
            ...(author.orcid ? { o: author.orcid } : {}),
            ...(sameParts(author) ? {} : { p: [author.firstName, author.middleName, author.surname] }),
          }),
      ...(author.contributorType === "non-author" ? { t: 1 } : {}),
      s: scoreByRole(author),
      ...(!isGroup(author) && author.equalContribution ? { e: 1 } : {}),
      ...(!isGroup(author) && author.corresponding ? { c: 1 } : {}),
    })),
    // Last, so dropping it gives back the exact payload the token's nonce hashes.
    ...(input.idToken && reply ? { k: input.idToken } : {}),
  };
  const checked = SharePayloadSchema.safeParse(payload);
  if (!checked.success) throw new UnsharableDraftError(checked.error.issues[0]?.message ?? "invalid payload");
  return JSON.stringify(payload);
}

/** Parts a link may set: a surname, and each part found in the name, so they cannot rename the contributor. */
function partsOf(name: string, parts: readonly string[]): boolean {
  return parts[2] !== "" && parts.every((part) => name.includes(part));
}

/** Whether the name parses back to the parts the author has, so the link need not carry them. */
function sameParts(author: Person): boolean {
  const parsed = parseNameParts(author.name);
  return (
    parsed.firstName === author.firstName &&
    parsed.middleName === author.middleName &&
    parsed.surname === author.surname
  );
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
  const toolchain = ToolchainSchema.safeParse(payload.h).data;
  const authors = deduplicateAuthorInitials(
    payload.a.map((entry) => {
      const contributions = CREDIT_ROLES.map((role, index) => ({
        role: role.name,
        // A payload from a build with fewer roles simply has a shorter array;
        // the roles it did not know about read as unassigned.
        score: clampScore(entry.s[index] ?? 0),
      }));
      if (entry.g === 1) {
        return createGroup(entry.n, {
          id: entry.i,
          ...(entry.l ? { alias: entry.l } : {}),
          ...(entry.r ? { ror: entry.r } : {}),
          members: entry.m ?? [],
          membersAre: entry.a === 1 ? "authors" : "collaborators",
          ...(entry.u ? { contactId: entry.u } : {}),
          contributorType: entry.t === 1 ? "non-author" : "author",
          contributions,
        });
      }
      return createAuthor(entry.n, {
        id: entry.i,
        ...(entry.o ? { orcid: entry.o } : {}),
        ...(entry.p && partsOf(entry.n, entry.p)
          ? { firstName: entry.p[0], middleName: entry.p[1], surname: entry.p[2] }
          : {}),
        contributorType: entry.t === 1 ? "non-author" : "author",
        contributions,
        equalContribution: entry.e === 1,
        corresponding: entry.c === 1,
      });
    }),
  );

  return {
    authors,
    ...(toolchain ? { toolchain } : {}),
    ...(payload.h !== undefined && !toolchain ? { toolchainDropped: true as const } : {}),
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
