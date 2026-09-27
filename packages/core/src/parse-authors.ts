import type { Author, Contribution, ContributorType } from "./author";
import { isUsableAuthorName, isValidOrcid, MAX_AUTHOR_NAME_LENGTH, normalizeOrcid, ORCID_INPUT_REGEX } from "./author";
import { CREDIT_ROLES } from "./credit-roles";

/**
 * Parse a single display name string into first / middle / surname parts.
 * Mirrors the logic from the original Python app's `extract_name_parts()`.
 *
 * Rules:
 *  - Strip punctuation/digits, keeping Unicode letters, combining marks,
 *    apostrophes, hyphens and whitespace (so "José", "O'Brien" and
 *    "Mary-Jane" survive intact)
 *  - First token  → firstName
 *  - Last token   → surname  (when >1 token)
 *  - Middle token → middleName (only when >2 tokens; first of any middle tokens)
 *
 * A single-token name (e.g. "Madonna") yields a firstName with empty
 * middleName and surname. That is intentional, not an error.
 */
export function parseNameParts(name: string): {
  firstName: string;
  middleName: string;
  surname: string;
} {
  const commaParts = name
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaParts.length === 2 && isSurnamePart(commaParts[0] ?? "") && isGivenNamePart(commaParts[1] ?? "")) {
    const surname = cleanNamePart(commaParts[0] ?? "");
    const givenParts = cleanNamePart(commaParts[1] ?? "")
      .split(/\s+/)
      .filter(Boolean);
    return {
      firstName: givenParts[0] ?? "",
      middleName: givenParts.length > 1 ? (givenParts[1] ?? "") : "",
      surname,
    };
  }

  // Keep the straight apostrophe plus the typographic (U+2019) and modifier
  // (U+02BC) variants that iOS/Word autocorrect emit, so "O'Brien" survives.
  const cleaned = cleanNamePart(name);
  const parts = cleaned.split(/\s+/).filter(Boolean);

  const firstName = parts[0] ?? "";
  const surname = parts.length > 1 ? (parts.at(-1) ?? "") : "";
  const middleName = parts.length > 2 ? (parts[1] ?? "") : "";

  return { firstName, middleName, surname };
}

function cleanNamePart(value: string): string {
  return value.replace(/[^\p{L}\p{M}'’ʼ\-\s]/gu, "").trim();
}

/** A run of scripts written without spaces between family and given name. */
const UNSPACED_NAME_REGEX = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]+$/u;

/**
 * Build initials from name parts (e.g. "Jane A. Smith" → "JAS").
 * Only uses first letter of each non-empty part. A single-token CJK name
 * ("王小明") has no initials to take, so the whole name is the label.
 */
function buildInitials(firstName: string, middleName: string, surname: string): string {
  if (!(middleName || surname) && UNSPACED_NAME_REGEX.test(firstName)) return firstName;
  return (
    [firstName, middleName, surname]
      .filter(Boolean)
      // Iterate by code point so an astral first letter isn't split into a
      // lone surrogate half.
      .map((p) => [...p][0]?.toUpperCase() ?? "")
      .join("")
  );
}

/**
 * Given a list of raw name strings, parse them and assign unique initials.
 *
 * When two authors would share the same initials, we disambiguate by
 * appending lowercase characters from the surname, matching the original
 * Python app's `generate_unique_initials()` strategy.
 */
export function createAuthor(
  name: string,
  overrides?: {
    id?: string;
    orcid?: string;
    contributorType?: ContributorType;
    contributions?: Contribution[];
    /** Shares first authorship. Outside the CRediT taxonomy; see AuthorSchema. */
    equalContribution?: boolean;
    /** Is a corresponding author. Outside the CRediT taxonomy; see AuthorSchema. */
    corresponding?: boolean;
    /**
     * Pre-split name parts, for callers that already hold structured names
     * (e.g. JATS `<surname>`/`<given-names>`). Re-parsing a joined string
     * cannot recover a multi-word surname: "Anne van der Berg" parses back as
     * surname "Berg" with "van" as a middle name, which also changes initials.
     */
    firstName?: string;
    middleName?: string;
    surname?: string;
  },
): Author {
  const parsed = parseNameParts(name);
  const firstName = overrides?.firstName ?? parsed.firstName;
  const middleName = overrides?.middleName ?? parsed.middleName;
  const surname = overrides?.surname ?? parsed.surname;

  // Punctuation-only names ("-- --") survive cleanNamePart, which keeps hyphens
  // and apostrophes. Share one predicate with AuthorSchema.name: a schema that
  // accepts what this throws on turns a bad import into a crash, and the
  // reverse silently admits a nameless contributor.
  if (!isUsableAuthorName(name)) {
    throw new Error("Author name must contain at least one letter.");
  }
  if (name.length > MAX_AUTHOR_NAME_LENGTH) {
    throw new Error(`Author name must be ${MAX_AUTHOR_NAME_LENGTH} characters or fewer.`);
  }

  if (overrides?.orcid && !isValidOrcid(overrides.orcid)) {
    throw new Error(`Invalid ORCID iD: "${overrides.orcid}"`);
  }

  return {
    id: overrides?.id ?? globalThis.crypto.randomUUID(),
    name,
    firstName,
    middleName,
    surname,
    initials: buildInitials(firstName, middleName, surname),
    ...(overrides?.orcid ? { orcid: normalizeOrcid(overrides.orcid) } : {}),
    contributorType: overrides?.contributorType ?? "author",
    contributions: normalizeContributions(overrides?.contributions),
    equalContribution: overrides?.equalContribution ?? false,
    corresponding: overrides?.corresponding ?? false,
  };
}

/**
 * Project an arbitrary contributions list onto the canonical CREDIT_ROLES order
 * and length, keyed by role name. Imported, shared, or older-export data may
 * carry contributions in a different order or with roles missing; the matrix and
 * heatmap index contributions positionally, so they must be canonicalized here.
 */
function normalizeContributions(contributions?: Contribution[]): Contribution[] {
  // Merge duplicate role entries (legal in an imported array) by keeping the
  // highest score, rather than letting a trailing 0 silently erase a real score.
  const scoreByRole = new Map<string, number>();
  for (const c of contributions ?? []) {
    scoreByRole.set(c.role, Math.max(scoreByRole.get(c.role) ?? 0, c.score));
  }
  return CREDIT_ROLES.map((r) => ({ role: r.name, score: scoreByRole.get(r.name) ?? 0 }));
}

/**
 * Assign unique initials across a list of authors without mutating the input.
 * Returns a new array of authors; the originals are left untouched.
 */
export function deduplicateAuthorInitials(authors: Author[]): Author[] {
  const existingInitials = new Set<string>();

  return authors.map((author) => {
    const initials = author.initials;
    const surnameCodePoints = [...author.surname];
    let attempt = initials;
    let extraIdx = 1;

    while (existingInitials.has(attempt)) {
      if (extraIdx < surnameCodePoints.length) {
        attempt = initials + (surnameCodePoints[extraIdx]?.toLowerCase() ?? String(extraIdx));
        extraIdx += 1;
      } else {
        // Keep counting: a fixed suffix loops forever when it is already taken.
        attempt = initials + String(extraIdx);
        extraIdx += 1;
      }
    }

    existingInitials.add(attempt);
    return { ...author, initials: attempt };
  });
}

export function parseAuthors(names: string[]): Author[] {
  return deduplicateAuthorInitials(names.map((name) => createAuthor(name)));
}

/** Surname particles that stay attached to the surname ("van der Berg, Anne"). */
const PARTICLES = new Set([
  "van",
  "von",
  "de",
  "del",
  "della",
  "di",
  "da",
  "du",
  "le",
  "la",
  "den",
  "der",
  "ten",
  "ter",
]);

/** A bare surname: one word, or particles followed by one word. Never an ORCID. */
function isSurnamePart(text: string): boolean {
  if (ORCID_INPUT_REGEX.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  const last = words.pop();
  if (!last || !/\p{L}/u.test(last)) return false;
  return words.every((word) => PARTICLES.has(word.toLowerCase()));
}

/** A given-name fragment: up to three words, each a name or an initial ("J.", "Marie"). */
function isGivenNamePart(text: string): boolean {
  if (ORCID_INPUT_REGEX.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 3 && words.every((word) => /^\p{L}[\p{L}\p{M}'’ʼ-]*\.?$/u.test(word));
}

/**
 * Split typed or pasted text into contributor name tokens. Newlines and
 * semicolons always separate. A comma is ambiguous on its own: it separates
 * contributors ("Marie Curie, Jane Smith") or the halves of one inverted name
 * ("Curie, Marie"), so the choice is made per line, over the whole chunk list
 * rather than per comma: a line is read as inverted names only when its chunks
 * pair up cleanly as surname + given name. Anything else is a delimiter list.
 */
export function splitNameList(text: string): string[] {
  return text
    .split(/[\n;]+/)
    .flatMap((line) => splitCommaLine(line))
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitCommaLine(line: string): string[] {
  const chunks = line
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (chunks.length < 2 || chunks.length % 2 !== 0) return chunks;

  // NOTE: a comma-only list of mononyms ("Cher, Madonna") reads as one
  // inverted name. Genuinely undecidable without a name database, so use
  // semicolons or newlines to force separation.
  const pairs: string[] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    const surname = chunks[i] ?? "";
    const given = chunks[i + 1] ?? "";
    if (!isSurnamePart(surname) || !isGivenNamePart(given)) return chunks;
    pairs.push(`${surname}, ${given}`);
  }
  return pairs;
}

/**
 * Parse a newline- or comma-separated string of author names into Author objects.
 * Empty lines / entries are ignored.
 */
export function parseAuthorText(text: string): Author[] {
  return parseAuthors(splitNameList(text));
}
