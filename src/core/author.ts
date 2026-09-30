import * as z from "zod";
import type { CreditRoleName } from "./credit-roles";
import { CREDIT_ROLES } from "./credit-roles";

export const MAX_AUTHORS = 200;
export const MAX_AUTHOR_NAME_LENGTH = 500;
export const MAX_IMPORT_BYTES = 1_000_000;

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
export const ContributionSchema = z.object({
  role: z.enum(CREDIT_ROLES.map((r) => r.name) as [CreditRoleName, ...CreditRoleName[]]),
  score: z.number().int().min(0).max(100),
});

export type Contribution = z.infer<typeof ContributionSchema>;

/** ORCID iD bare format: 0000-0001-2345-678X */
export const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/;

/** ORCID iD accepted on input: bare form or the canonical orcid.org URL. */
export const ORCID_INPUT_REGEX = /^(https?:\/\/orcid\.org\/)?\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/;

/** Return the canonical bare ORCID form used in state and exports. */
export function normalizeOrcid(id: string): string {
  return id.replace(/^https?:\/\/orcid\.org\//, "");
}

/**
 * Validate an ORCID iD fully: correct shape *and* a valid ISO 7064 MOD 11-2
 * check digit. The shape regexes alone accept checksum-invalid iDs (e.g. a
 * mistyped digit), which would then be exported as if verified.
 * Accepts the bare form or the orcid.org URL.
 */
export function isValidOrcid(id: string): boolean {
  if (!ORCID_INPUT_REGEX.test(id)) return false;
  const digits = normalizeOrcid(id).replace(/-/g, "");
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

export const AuthorSchema = z.object({
  /** Stable unique identifier for UI state and persistence */
  id: z
    .string()
    .min(1)
    .default(() => globalThis.crypto.randomUUID()),
  /**
   * Display name as entered by the user (e.g. "Jane A. Smith").
   *
   * The letter check mirrors `createAuthor`, which throws on a name that keeps
   * no letters once punctuation and digits are stripped. Without it the schema
   * accepts names (e.g. "123") that every downstream `normalizeAuthors` call
   * then throws on, turning a bad import into a crash instead of an error.
   */
  name: z
    .string()
    .min(1)
    .max(MAX_AUTHOR_NAME_LENGTH)
    .refine(isUsableAuthorName, "Author name must contain at least one letter."),
  /** Parsed first name */
  firstName: z.string().max(MAX_AUTHOR_NAME_LENGTH),
  /** Parsed middle name (may be empty) */
  middleName: z.string().max(MAX_AUTHOR_NAME_LENGTH),
  /** Parsed surname */
  surname: z.string().max(MAX_AUTHOR_NAME_LENGTH),
  /**
   * Unique initials (e.g. "JAS"). Generated automatically, deduplicated
   * across the author list. Used in the short statement format.
   */
  initials: z.string().max(MAX_AUTHOR_NAME_LENGTH),
  /**
   * ORCID iD in URL form (e.g. "https://orcid.org/0000-0002-1825-0097")
   * or bare 16-digit format ("0000-0002-1825-0097"). Optional.
   */
  orcid: z.string().refine(isValidOrcid, "Invalid ORCID iD.").transform(normalizeOrcid).optional(),
  /**
   * Whether this person is a named author or a non-author contributor credited
   * in an Acknowledgements section. CRediT applies to both (see NISO guidance);
   * the distinction drives the JATS `contrib-type`. Defaults to "author".
   */
  contributorType: z.enum(["author", "non-author"]).default("author"),
  /**
   * Scores for each of the 14 CRediT roles, keyed by role name.
   *
   * Deliberately not capped at `CREDIT_ROLES.length`: an imported array may
   * legally repeat a role, and `normalizeContributions` merges duplicates by
   * keeping the highest score. A cap here rejects that payload outright.
   */
  contributions: z.array(ContributionSchema),
  /**
   * Whether this person shares first authorship with others so marked. Not a
   * CRediT role — the taxonomy has no slot for it — but journals ask for it in
   * the same paragraph, so it travels with the contributions.
   */
  equalContribution: z.boolean().default(false),
  /** Whether this person is a corresponding author. Also outside CRediT. */
  corresponding: z.boolean().default(false),
});

export type Author = z.infer<typeof AuthorSchema>;

/** Author (named on the byline) vs. non-author contributor (Acknowledgements). */
export type ContributorType = Author["contributorType"];

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

export function scoreToLevel(score: number): ContributionLevel {
  if (score === 0) return "none";
  if (score <= 33) return "supporting";
  if (score <= 66) return "equal";
  return "lead";
}

/** True if the author has any non-zero contribution */
export function hasContributions(author: Author): boolean {
  return author.contributions.some((c) => c.score > 0);
}

/**
 * True when every contribution across all authors is binary (0 or 100), i.e.
 * no intermediate levels exist, so a "show levels" control has nothing to show.
 * Treats an empty author list as binary.
 */
export function isAllBinary(authors: Author[]): boolean {
  return authors.every((author) => author.contributions.every((c) => c.score === 0 || c.score === 100));
}

/** Role names that at least one author contributed to (score > 0), in CRediT order. */
export function rolesWithContributions(authors: Author[]): string[] {
  const active = new Set<string>();
  for (const author of authors) {
    for (const c of author.contributions) {
      if (c.score > 0) active.add(c.role);
    }
  }
  return CREDIT_ROLES.map((r) => r.name).filter((name) => active.has(name));
}

/** Return only roles where score > 0 for a given author */
export function activeContributions(author: Author): Contribution[] {
  return author.contributions.filter((c) => c.score > 0);
}
