import * as z from "zod/mini";
import type { CreditRoleName } from "./credit-roles";
import { CREDIT_ROLES } from "./credit-roles";

export const MAX_AUTHORS = 420;
export const MAX_AUTHOR_NAME_LENGTH = 500;
/** Caps every import, fetch and share link; a full draft's JATS export is 1 to 1.5 MB. */
export const MAX_IMPORT_BYTES = 2_000_000;
/**
 * A contributor or draft id that fits in a share link. Never a name
 * `Object.prototype` already has ("constructor", "__proto__"): asks are kept in
 * plain objects keyed by id, where such a key reads or sets the prototype.
 */
export function isShareableId(id: string): boolean {
  return /^[\w-]{1,64}$/.test(id) && !(id in Object.prototype);
}

/**
 * A contribution is a 0–100 integer score for one CRediT role.
 *
 * Score semantics (used by UI and statement generation). The non-zero tiers use
 * NISO's optional "degree of contribution" vocabulary (lead / equal / supporting):
 *   0       = no contribution
 *   1–33    = supporting
 *   34–66   = equal
 *   67–100  = lead
 *
 * Storing a continuous score (not just a boolean) lets us express
 * contribution levels without committing to a fixed tier count in
 * the data model: the UI input mode is a presentation concern only.
 */
// NOTE: every module-level schema in the package sits in a `@__PURE__` arrow that runs once.
// The `.check()` calls inside a schema stop a bundler from dropping it, so without the
// wrapper an app that never validates still ships all of zod (package.test.ts checks this).
export const ContributionSchema = /* @__PURE__ */ (() =>
  z.object({
    role: z.enum(CREDIT_ROLES.map((r) => r.name) as [CreditRoleName, ...CreditRoleName[]]),
    score: z.int().check(z.gte(0), z.lte(100)),
  }))();

export type Contribution = z.infer<typeof ContributionSchema>;

/** ORCID iD bare format: 0000-0001-2345-678X */
export const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/;

/** ORCID iD accepted on input: bare form or the canonical orcid.org URL. */
export const ORCID_INPUT_REGEX = /^(https?:\/\/orcid\.org\/)?\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/;

/**
 * Return the canonical bare ORCID form used in state and exports. Takes what
 * people paste: surrounding spaces, the orcid.org address with or without its
 * scheme or a trailing slash, and a lower-case check character.
 */
export function normalizeOrcid(id: string): string {
  return id
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?orcid\.org\//i, "")
    .replace(/\/$/, "")
    .toUpperCase();
}

/**
 * Validate an ORCID iD fully: correct shape *and* a valid ISO 7064 MOD 11-2
 * check digit. The shape regexes alone accept checksum-invalid iDs (e.g. a
 * mistyped digit), which would then be exported as if verified.
 * Accepts any form `normalizeOrcid` reads; store its result, not the input.
 */
export function isValidOrcid(id: string): boolean {
  const bare = normalizeOrcid(id);
  if (!ORCID_REGEX.test(bare)) return false;
  const digits = bare.replace(/-/g, "");
  let total = 0;
  for (let i = 0; i < 15; i += 1) total = (total + Number(digits[i])) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits[15] === (check === 10 ? "X" : String(check));
}

/**
 * A name `createAuthor` can build a contributor from.
 *
 * Normally that means at least one letter. A bare ORCID iD is the deliberate
 * exception: adding a contributor by iD seeds the row named after the iD and
 * fills the real name from the registry afterwards, and a row whose lookup
 * failed keeps that placeholder on purpose; so it has to survive validation,
 * persistence and export.
 */
export function isUsableAuthorName(name: string): boolean {
  return /[\p{L}\p{M}]/u.test(name) || ORCID_INPUT_REGEX.test(name.trim());
}

/** Most members one group lists; a consortium paper can name thousands. */
export const MAX_GROUP_MEMBERS = 5000;

/** ROR id alphabet: Crockford base32 without i, l, o and u. */
// biome-ignore lint/security/noSecrets: an alphabet, not a credential.
const ROR_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ROR_REGEX = /^0[0-9a-hjkmnp-tv-z]{6}\d{2}$/;

/** The bare nine-character ROR id from what people paste: the ror.org address or the id alone. */
export function normalizeRor(id: string): string {
  return id
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?ror\.org\//i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** A ROR id with the right shape and checksum (98 minus the base-32 body times 100, mod 97). No lookup. */
export function isValidRor(id: string): boolean {
  const bare = normalizeRor(id);
  if (!ROR_REGEX.test(bare)) return false;
  let n = 0;
  for (const char of bare.slice(1, 7)) n = n * 32 + ROR_ALPHABET.indexOf(char);
  return 98 - ((n * 100) % 97) === Number(bare.slice(7));
}

const NAME_MESSAGE = "Author name must contain at least one letter.";

/** Field schemas a person and a group share; each builds its own, in its own key order. */
const idField = () => z._default(z.string().check(z.minLength(1)), () => globalThis.crypto.randomUUID());
const nameField = () =>
  /**
   * Display name as entered by the user (e.g. "Grace B. Hopper").
   *
   * The letter check mirrors `createAuthor`, which throws on a name that keeps
   * no letters once punctuation and digits are stripped. Without it the schema
   * accepts names (e.g. "123") that every downstream `normalizeRoster` call
   * then throws on, turning a bad import into a crash instead of an error.
   */
  z.string().check(z.minLength(1), z.maxLength(MAX_AUTHOR_NAME_LENGTH), z.refine(isUsableAuthorName, NAME_MESSAGE));
/**
 * Unique initials (e.g. "GBH"). Generated automatically, deduplicated
 * across the author list. Used in the short statement format.
 */
const initialsField = () => z.string().check(z.maxLength(MAX_AUTHOR_NAME_LENGTH));
/**
 * Whether this contributor is a named author or a non-author contributor credited
 * in an Acknowledgements section. CRediT applies to both (see NISO guidance);
 * the distinction drives the JATS `contrib-type`. Defaults to "author".
 */
const typeField = () => z._default(z.enum(["author", "non-author"]), "author");
/**
 * Scores for each of the 14 CRediT roles, keyed by role name.
 *
 * Deliberately not capped at `CREDIT_ROLES.length`: an imported array may
 * legally repeat a role, and `normalizeContributions` merges duplicates by
 * keeping the highest score. A cap here rejects that payload outright.
 */
const contributionsField = () => z.array(ContributionSchema);

export const PersonSchema = /* @__PURE__ */ (() =>
  z.object({
    /** Absent in a file or save from before groups: such a row is a person. */
    kind: z._default(z.literal("person"), "person"),
    /** Stable unique identifier for UI state and persistence */
    id: idField(),
    name: nameField(),
    /** Parsed first name */
    firstName: z.string().check(z.maxLength(MAX_AUTHOR_NAME_LENGTH)),
    /** Parsed middle name (may be empty) */
    middleName: z.string().check(z.maxLength(MAX_AUTHOR_NAME_LENGTH)),
    /** Parsed surname */
    surname: z.string().check(z.maxLength(MAX_AUTHOR_NAME_LENGTH)),
    initials: initialsField(),
    /**
     * ORCID iD, stored bare ("0000-0002-1825-0097"). Input may also be the
     * orcid.org URL form; the transform strips it. Optional.
     */
    orcid: z.optional(
      z.pipe(z.string().check(z.refine(isValidOrcid, "Invalid ORCID iD.")), z.transform(normalizeOrcid)),
    ),
    contributorType: typeField(),
    contributions: contributionsField(),
    /**
     * Whether this person shares first authorship with others so marked. Not a
     * CRediT role: the taxonomy has no slot for it, but journals ask for it in
     * the same paragraph, so it travels with the contributions.
     */
    equalContribution: z._default(z.boolean(), false),
    /** Whether this person is a corresponding author. Also outside CRediT. */
    corresponding: z._default(z.boolean(), false),
  }))();

/** A group member: a name, optionally tied to a person row of the same draft. */
export const MemberSchema = /* @__PURE__ */ (() =>
  z.object({
    name: z.string().check(z.minLength(1), z.maxLength(MAX_AUTHOR_NAME_LENGTH)),
    /** Id of a person row. A row delete or merge drops it and keeps the name. */
    personId: z.optional(z.string().check(z.minLength(1))),
  }))();

/**
 * A consortium or collaborative credited as one contributor ("COVIDSurg Collaborative").
 * It has no ORCID, never corresponds, and cannot be the signed-in or claimed row.
 */
export const GroupSchema = /* @__PURE__ */ (() =>
  z.object({
    kind: z.literal("group"),
    id: idField(),
    name: nameField(),
    initials: initialsField(),
    contributorType: typeField(),
    contributions: contributionsField(),
    /** Short form for chips and heatmap labels. Without it, `initials` come from the name. */
    alias: z.optional(z.string().check(z.minLength(1), z.maxLength(MAX_AUTHOR_NAME_LENGTH))),
    /** ROR id, stored bare ("05dxps055"). Format and checksum only; never looked up. */
    ror: z.optional(z.pipe(z.string().check(z.refine(isValidRor, "Invalid ROR id.")), z.transform(normalizeRor))),
    members: z._default(z.array(MemberSchema).check(z.maxLength(MAX_GROUP_MEMBERS)), []),
    /** Whether the members are authors of the work or collaborators. One flag for the whole list. */
    membersAre: z._default(z.enum(["authors", "collaborators"]), "collaborators"),
    /** Person row that answers review requests for the group. Must be a linked member. */
    contactId: z.optional(z.string().check(z.minLength(1))),
  }))();

/** One row of the contributor list. */
export const ContributorSchema = /* @__PURE__ */ (() => z.discriminatedUnion("kind", [PersonSchema, GroupSchema]))();

export type Person = z.infer<typeof PersonSchema>;
/**
 * The person-only fields, typed as always absent on a group, so `row.orcid` or `row.corresponding`
 * reads as `undefined` on any contributor without a `kind` check. The schema strips them from a group.
 */
interface PersonOnly {
  readonly orcid?: undefined;
  readonly firstName?: undefined;
  readonly middleName?: undefined;
  readonly surname?: undefined;
  readonly equalContribution?: undefined;
  readonly corresponding?: undefined;
}
export type Group = z.infer<typeof GroupSchema> & PersonOnly;
export type Member = z.infer<typeof MemberSchema>;
export type Contributor = Person | Group;

/** True for a person row; groups have no ORCID, name parts or corresponding flag. */
export function isPerson(contributor: Contributor): contributor is Person {
  return contributor.kind === "person";
}

/** The ORCID iD of a row; a group has none. */
export function orcidOf(contributor: Contributor): string | undefined {
  return isPerson(contributor) ? contributor.orcid : undefined;
}

/** True for a group row. */
export function isGroup(contributor: Contributor): contributor is Group {
  return contributor.kind === "group";
}

/** Author (named on the byline) vs. non-author contributor (Acknowledgements). */
export type ContributorType = Contributor["contributorType"];

/**
 * Contribution level derived from a 0-100 score, using NISO's optional
 * degree-of-contribution terms (lead / equal / supporting).
 */
export type ContributionLevel = "none" | "supporting" | "equal" | "lead";

/**
 * Coerce any number to a valid score: an integer 0–100, with NaN and infinities
 * read as 0. Imported and hand-edited data is not trusted to be either.
 */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** The score each level stores: the top of its `scoreToLevel` band. */
export const LEVEL_SCORE = { none: 0, supporting: 33, equal: 66, lead: 100 } as const satisfies Record<
  ContributionLevel,
  number
>;

export function scoreToLevel(score: number): ContributionLevel {
  if (score === 0) return "none";
  if (score <= 33) return "supporting";
  if (score <= 66) return "equal";
  return "lead";
}

/** True if the author has any non-zero contribution */
export function hasContributions(author: Contributor): boolean {
  return author.contributions.some((c) => c.score > 0);
}

/**
 * True when every contribution across all authors is binary (0 or 100), i.e.
 * no intermediate levels exist, so a "show levels" control has nothing to show.
 * Treats an empty author list as binary.
 */
export function isAllBinary(authors: Contributor[]): boolean {
  return authors.every((author) => author.contributions.every((c) => c.score === 0 || c.score === 100));
}

/** Role names that at least one author contributed to (score > 0), in CRediT order. */
export function rolesWithContributions(authors: Contributor[]): string[] {
  const active = new Set<string>();
  for (const author of authors) {
    for (const c of author.contributions) {
      if (c.score > 0) active.add(c.role);
    }
  }
  return CREDIT_ROLES.map((r) => r.name).filter((name) => active.has(name));
}

/** Return only roles where score > 0 for a given author */
export function activeContributions(author: Contributor): Contribution[] {
  return author.contributions.filter((c) => c.score > 0);
}
