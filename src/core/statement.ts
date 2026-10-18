/**
 * Rule-based parser for free-text CRediT statements, matched against the paper's author list.
 *
 * A port of the census parser (census/src/census/statement.py and roles.py), kept to the same
 * output: the parity test runs both over census/tests/corpus.jsonl. Change the two together.
 *
 * It handles the two layouts publishers use, whatever the punctuation:
 *
 * - author first: "AP: conceptualization, methodology; NZ, LS: writing - original draft."
 * - role first (MDPI): "Conceptualization, A.B. and C.D.; Methodology, A.B."
 *
 * It finds every author mention (full name, surname plus initials, or initials resolved against the
 * author list) and every role name, splits the text into clauses, and within each clause groups
 * neighbours of the same kind into runs and pairs each run with the run that follows it. Prose
 * ("A.B. conceived the study") names no CRediT role, so it yields nothing rather than a guess.
 * Initials that fit no author, or several, are reported, never guessed.
 */
import type { Author } from "./author";
import { CREDIT_ROLES, type CreditRoleName } from "./credit-roles";

/** An author as the parser needs it: given names and surname, as separate strings. */
export interface StatementAuthor {
  given: string;
  surname: string;
}

/**
 * A contributor's name split the way the parser needs it. The given names are everything in the
 * display name before the surname, so "Jane Anne Marie Smith" keeps all three, and "Smith, Jane"
 * reads the part after the comma.
 */
export function statementAuthor(
  author: Pick<Author, "name" | "firstName" | "middleName" | "surname">,
): StatementAuthor {
  const { name, surname } = author;
  const comma = name.indexOf(",");
  if (surname && comma > 0 && name.slice(0, comma).includes(surname)) {
    return { given: name.slice(comma + 1).trim(), surname };
  }
  const at = surname ? name.lastIndexOf(surname) : -1;
  const given = at > 0 ? name.slice(0, at).trim() : [author.firstName, author.middleName].filter(Boolean).join(" ");
  return { given, surname };
}

/** What {@link parseStatement} read. */
export interface ParsedStatement {
  /** Each author (an index into the list passed in) and role the statement pairs, in author then CRediT order. */
  assignments: { author: number; role: CreditRoleName }[];
  /** Initials-like tokens and names that matched no author, or more than one, in the order found. */
  unresolved: string[];
}

// Python's \w: any letter, digit or number, or "_". JS's \w and \b are ASCII-only.
const W = String.raw`[\p{L}\p{N}_]`;
// A capital for initials: any letter or number but a-z and digits (Python's [^\W\d_a-z]).
const U = String.raw`(?![a-z])[\p{L}\p{Nl}\p{No}]`;

/** CRediT wording publishers use, by role slug, matched case-insensitively on `clean`ed text. */
const ROLE_PATTERNS: Record<string, string> = {
  conceptualization: "conceptuali[sz]ation",
  "data-curation": "data curation",
  "formal-analysis": "formal analys[ie]s",
  "funding-acquisition": "funding acquisition",
  investigation: "investigation",
  methodology: "methodology",
  "project-administration": "project administration",
  resources: "resources",
  software: "software",
  supervision: "supervision",
  validation: "validation",
  visualization: "visuali[sz]ation",
  "writing-original-draft": "(?:writing ?- ?)?original draft(?: preparation)?",
  "writing-review-editing": "(?:writing ?- ?)?review(?:ing)? and edit(?:ing)?",
};
const SLUGS = Object.keys(ROLE_PATTERNS);
const ROLE_RE = new RegExp(
  Object.values(ROLE_PATTERNS)
    .map((p) => `((?<!${W})${p}(?!${W}))`)
    .join("|"),
  "giu",
);
const ROLE_BY_SLUG = new Map(CREDIT_ROLES.map((role) => [role.url.split("/").at(-2), role.name]));

// Terms prose rarely uses. "Supervision", "software" or "investigation" alone turn up in narrative
// statements ("under the supervision of NS") and ICMJE lists, which are not CRediT.
const DISTINCT = new Set([
  "conceptualization",
  "data-curation",
  "formal-analysis",
  "funding-acquisition",
  "project-administration",
  "visualization",
  "writing-original-draft",
  "writing-review-editing",
]);

const DASHES = /\s*[‐-―−-]+\s*/gu;
const SPACES = /\s+/gu;

/** One kind of dash, single spaces, "&" as "and". Keeps case, which initials need. */
function clean(text: string): string {
  return text.replaceAll("&", " and ").replace(DASHES, " - ").replace(SPACES, " ").trim();
}

/** (start, end, slug) for each role named in `clean`ed text, in order. */
function findRoles(text: string): [number, number, string][] {
  return Array.from(text.matchAll(ROLE_RE), (m) => [
    m.index,
    m.index + m[0].length,
    SLUGS[m.findIndex((group, i) => i > 0 && group !== undefined) - 1] ?? "",
  ]);
}

/**
 * Whether text uses CRediT's own vocabulary, not just a common word that is also a role: at least
 * one of conceptualization, data curation, formal analysis, funding acquisition, project
 * administration, visualization, original draft or review and editing.
 */
export function namesCredit(text: string): boolean {
  return findRoles(clean(text.normalize("NFC"))).some(([, , slug]) => DISTINCT.has(slug));
}

const ALL_AUTHORS = -1;
/** Holds an unresolved author's place, so the roles next to it are not paired with a neighbour. */
const UNRESOLVED = -2;

// Initials such as "AP", "Q.M.L.", "H.Š.", "YiL" (Frontiers adds letters to tell authors apart),
// "L. - J. Z.". Tokens that start lower-case are skipped later. A space after a dot only continues
// the token before another initial with a dot, so "EF. AB is the guarantor" stops at "EF.".
// Lower-case particles between dots ("F.d.S.N." for Fernanda da Silva Nunes) belong to the token.
const PARTICLES = String.raw`(?:\.[a-z](?=\.))*`;
const INITIALS_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.])${U}[a-z]{0,2}${PARTICLES}` +
    String.raw`(?:(?:\.(?! )|\. (?=${U}\.)|\.? - )?${U}[a-z]{0,2}${PARTICLES}){0,5}\.?(?!${W})`,
  "gu",
);
const ALL_RE = new RegExp(`(?<!${W})all (?:the )?(?:other )?authors(?!${W})`, "giu");
// The closing "All authors read and approved the manuscript." is not a role assignment. "All authors
// contributed to the investigation" is, so only approval wording is dropped.
const APPROVAL_RE = new RegExp(
  `(?<!${W})all (?:the )?authors (?:have |has )?(?:read|approved|agreed|critically reviewed|reviewed and approved|gave)` +
    String.raw`[^;]*?(?:\.(?=\s|$)|;|$)`,
  "giu",
);
const PARTICLE_RE = /^(?:d[aeiou]s?|del(?:la)?|der|la|le|te[nr]|v[ao]n)$/u; // "da", "dos", "van", ...

const isUpper = (ch: string) => /^\p{Uppercase}/u.test(ch);
const isAlnum = (ch: string | undefined) => ch !== undefined && /^[\p{L}\p{N}_]/u.test(ch);
const first = (s: string) => [...s][0] ?? "";
// Python's casefold, for the letters where it differs from lower case and names use them.
const fold = (s: string) => s.toLowerCase().replaceAll("ß", "ss").replaceAll("ς", "σ");

/** Python's str.islower: some cased letter, and no upper- or title-case one. */
function isLowerWord(s: string): boolean {
  let cased = false;
  for (const ch of s) {
    if (/\p{Uppercase}|\p{Lt}/u.test(ch)) return false;
    if (/\p{Lowercase}/u.test(ch)) cased = true;
  }
  return cased;
}

type Parts = string[];

/**
 * Given-name parts, surname parts without lower-case particles ("de", "van" rarely get an initial
 * of their own), every surname word, and the surname without particles in any case ("De Luca").
 */
function nameParts(author: StatementAuthor): [Parts, Parts, Parts, Parts] {
  const given = author.given.split(/[\s.-]+/u).filter(Boolean);
  const words = author.surname.split(/[\s-]+/u).filter(Boolean);
  const surname = words.filter((p) => !isLowerWord(p));
  const core = words.filter((p) => !PARTICLE_RE.test(fold(p)));
  return [given, surname, words, core];
}

function fits(chunks: string[], parts: Parts): boolean {
  return chunks.length === parts.length && chunks.every((c, i) => fold(parts[i] ?? "").startsWith(fold(c)));
}

/** Initials for a given name written as one word: "Q.M. Li" for Qinming Li. */
function fitsLoosely(chunks: string[], given: Parts, surname: Parts): boolean {
  if (surname.length === 0) return false;
  const head = chunks.slice(0, -surname.length);
  const tail = chunks.slice(-surname.length);
  const [lead, ...others] = head;
  if (lead === undefined || !fits(tail, surname)) return false;
  const rest = fold(given.join(""));
  if (!rest.startsWith(fold(lead))) return false;
  let pos = lead.length;
  for (const chunk of others) {
    pos = rest.indexOf(fold(chunk), pos);
    if (pos < 0) return false;
    pos += chunk.length;
  }
  return true;
}

/** "YiL" -> ["Yi", "L"], "Q.M.L." -> ["Q", "M", "L"]: a new chunk at each capital. */
function chunksOf(token: string): string[] {
  const chunks: string[] = [];
  for (const ch of token.replace(/(?<=\.)[a-z](?=\.)/g, "")) {
    if (!/\p{L}/u.test(ch)) continue;
    if (isUpper(ch) || chunks.length === 0) chunks.push(ch);
    else chunks[chunks.length - 1] += ch;
  }
  return chunks;
}

/**
 * Index of the one author whose initials `token` spells, or null if none or several do.
 *
 * Orders are tried in turn, most usual first: given then surname, surname then given, first given
 * name only, a one-word given name; then particles as lower-case initials ("JvdB" for Jan van der
 * Berg), the surname without particles ("CL" for Chiara De Luca), and the first of two surnames ("JG"
 * for José García López). The first order any author fits decides, so "L.H." is Liang Hong even when
 * Hao Leng fits surname-first.
 */
export function resolveInitials(token: string, authors: readonly StatementAuthor[]): number | null {
  const chunks = chunksOf(token);
  if (chunks.length === 0) return null;
  const letters = chunks.join("");
  const parts = authors.map(nameParts);
  const tiers: ((g: Parts, s: Parts, w: Parts, c: Parts) => boolean)[] = [
    (g, s) => fits(chunks, [...g, ...s]),
    (g, s) => fits(chunks, [...s, ...g]),
    (g, s) => fits(chunks, [...g.slice(0, 1), ...s]),
    (g, s) => fitsLoosely(chunks, g, s),
    (g, _s, w) => letters === [...g, ...w].map(first).join(""),
    (g, _s, _w, c) => fits(chunks, [...g, ...c]),
    (g, _s, _w, c) => fits(chunks, [...g, ...c.slice(0, 1)]) || fits(chunks, [...g.slice(0, 1), ...c.slice(0, 1)]),
  ];
  for (const tier of tiers) {
    const hits = parts.flatMap((p, i) => (tier(...p) ? [i] : []));
    if (hits.length > 0) return hits.length === 1 ? (hits[0] ?? null) : null;
  }
  return null;
}

const mask = (text: string, start: number, end: number) =>
  text.slice(0, start) + " ".repeat(end - start) + text.slice(end);

/**
 * Full names, matched in any case: "Ann Smith", "Smith Ann", "Smith, Ann". And initials forms,
 * matched as written: Vancouver style "Smith AB" / "Smith A.B." / "Smith, A.B.", initials first
 * "AB Smith" / "A.B. Smith", and hyphenated given names as "Kim J-H" or "J.-H. Kim".
 */
function nameVariants(author: StatementAuthor): [Set<string>, Set<string>] {
  const { surname, given } = author;
  if (!surname) return [new Set(), new Set()];
  const name = `${given} ${surname}`.trim();
  const names = given ? [name, `${surname} ${given}`, `${surname}, ${given}`] : [surname];
  const initials = nameParts(author)[0].map(first).join("");
  const hyphened = given
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.split("-").filter(Boolean).map(first).join("-"));
  const dotted = hyphened.map((h) => `${h.replaceAll("-", ".-")}.`).join("");
  const forms = [initials, `${[...initials].join(".")}.`, hyphened.join(""), dotted];
  const short = forms
    .filter((f) => f.replace(/^\.+|\.+$/g, ""))
    .flatMap((f) => [`${surname} ${f}`, `${surname}, ${f}`, `${f} ${surname}`]);
  return [new Set(names.map(clean)), new Set(short.map(clean))];
}

const AFTER_INITIAL_RE = new RegExp(`(?<!${W})${U}(?:\\.|\\.? - )$`, "gu");
// A clause opening with a name the parser did not recognise: "Dunn, C: writing".
const NAME_COLON_RE = new RegExp(String.raw`${U}[^:;]*:\s*$`, "u");

/**
 * No word character on either side of text[start:end], nor an initial and a dot or dash before it:
 * "M. Li" is not inside "X.M. Li" or "X. - M. Li".
 */
function bounded(text: string, start: number, end: number): boolean {
  if (start && isAlnum(text[start - 1])) return false;
  if (end !== text.length && isAlnum(text[end])) return false;
  AFTER_INITIAL_RE.lastIndex = Math.max(0, start - 6);
  return AFTER_INITIAL_RE.exec(text.slice(0, start)) === null;
}

/** Start of each occurrence of `needle` in `hay` bounded in `text`, left to right without overlaps. */
function find(hay: string, needle: string, text: string): number[] {
  const found: number[] = [];
  let start = hay.indexOf(needle);
  while (start >= 0) {
    const end = start + needle.length;
    if (bounded(text, start, end)) {
      found.push(start);
      start = hay.indexOf(needle, end);
    } else {
      start = hay.indexOf(needle, start + 1);
    }
  }
  return found;
}

/** Lower case of the same length, so positions carry over: a letter that lowers to two keeps the first. */
function lower(text: string): string {
  const lowered = text.toLowerCase();
  if (lowered.length === text.length) return lowered;
  return Array.from(text, (ch) => {
    const l = first(ch.toLowerCase());
    return l.length === ch.length ? l : ch;
  }).join("");
}

type Kind = "A" | "R";
type Mention = [start: number, end: number, kind: Kind, value: number | string];

const compareMentions = (a: Mention, b: Mention) =>
  a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0) || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);

/**
 * Positions where one assignment clause ends: a semicolon; a full stop after a lower-case word
 * ("draft. NZ:"); and a full stop after an author ("Nam KC. Data curation", "A.B. Methodology",
 * "EF. AB is the guarantor"), but not "C.D.: writing", where the colon ties the author to the roles
 * after it.
 */
function clauseEnds(text: string, mentions: Mention[]): number[] {
  const ends = Array.from(text.matchAll(/;/g), (m) => m.index);
  for (const m of text.matchAll(/\.(?=\s|$)/gu)) {
    const before = m.index ? (text[m.index - 1] ?? "") : "";
    if (before === "" || isLowerWord(before) || ")]".includes(before)) ends.push(m.index);
  }
  const ordered = [...mentions].sort(compareMentions);
  for (let i = 1; i < ordered.length; i += 1) {
    const [, end, kind] = ordered[i - 1] as Mention;
    const [start, , nextKind] = ordered[i] as Mention;
    const gap = text.slice(end - 1, start);
    // "A.B. Methodology" ends a role-first clause; "EF. AB is the guarantor" starts a new sentence,
    // unless a comma or "and" joins the two authors ("C.D. and E.F.").
    const joined = new RegExp(`,|(?<!${W})and(?!${W})`, "u").test(gap);
    if (kind === "A" && gap.includes(".") && !gap.includes(":") && (nextKind === "R" || !joined)) ends.push(end);
  }
  return ends.sort((a, b) => a - b);
}

/** First index whose end is at or after `start`, as Python's bisect_left. */
function bisectLeft(ends: number[], start: number): number {
  let lo = 0;
  let hi = ends.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((ends[mid] ?? 0) < start) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The role assignments in a free-text CRediT statement. Author indices refer to `authors`.
 *
 * This does not judge whether the text is a CRediT statement at all: check {@link namesCredit}
 * first, as an ICMJE list or prose can still name a common role word ("software").
 */
export function parseStatement(statement: string, authorList: readonly StatementAuthor[]): ParsedStatement {
  const authors = authorList.map((a) => ({ given: a.given.normalize("NFC"), surname: a.surname.normalize("NFC") }));
  const original = clean(statement.normalize("NFC")).replace(APPROVAL_RE, (m) => " ".repeat(m.length));
  let text = original;
  const unresolved: string[] = [];
  const mentions: Mention[] = findRoles(text).map(([s, e, slug]) => [s, e, "R", slug]);
  // Mask roles so their capitals ("Writing") are not read as initials.
  for (const [start, end] of mentions) text = mask(text, start, end);

  // Each spelling maps to every author it fits; one two authors share stays unresolved. Longest first,
  // and "Surname, Given" forms last, so they cannot take a name out of a list: "Ann Lee, Bo Wu".
  const variants = new Map<string, { needle: string; anyCase: boolean; hits: Set<number> }>();
  const add = (needle: string, anyCase: boolean, i: number) => {
    const key = `${anyCase ? 1 : 0}${needle}`;
    const entry = variants.get(key) ?? { needle, anyCase, hits: new Set<number>() };
    entry.hits.add(i);
    variants.set(key, entry);
  };
  authors.forEach((a, i) => {
    const [names, short] = nameVariants(a);
    for (const v of names) {
      if (v.includes(" ")) add(lower(v), true, i);
      else add(v, false, i);
    }
    for (const v of short) add(v, false, i);
  });
  const sortKey = (v: { needle: string; anyCase: boolean }) =>
    [v.needle.includes(",") ? 1 : 0, -[...v.needle].length, v.needle, v.anyCase ? 1 : 0] as const;
  const ordered = [...variants.values()].sort((x, y) => {
    const a = sortKey(x);
    const b = sortKey(y);
    for (let k = 0; k < a.length; k += 1) {
      if (a[k] !== b[k]) return (a[k] as number | string) < (b[k] as number | string) ? -1 : 1;
    }
    return 0;
  });
  let lowered = lower(text);
  for (const { needle, anyCase, hits } of ordered) {
    for (const start of find(anyCase ? lowered : text, needle, text)) {
      const end = start + needle.length;
      if (hits.size === 1) {
        mentions.push([start, end, "A", [...hits][0] as number]);
      } else {
        mentions.push([start, end, "A", UNRESOLVED]);
        unresolved.push(text.slice(start, end));
      }
      text = mask(text, start, end);
      lowered = mask(lowered, start, end);
    }
  }
  for (const m of text.matchAll(ALL_RE)) {
    mentions.push([m.index, m.index + m[0].length, "A", ALL_AUTHORS]);
    text = mask(text, m.index, m.index + m[0].length);
  }
  // Role-first statements repeat each author's initials per role.
  const resolved = new Map<string, number | null>();
  for (const m of text.matchAll(INITIALS_RE)) {
    const token = m[0].trim();
    if (!isUpper(first(token))) continue;
    if (!resolved.has(token)) resolved.set(token, resolveInitials(token, authors));
    const i = resolved.get(token) ?? null;
    if (i !== null) {
      mentions.push([m.index, m.index + m[0].length, "A", i]);
    } else if ([...token].filter(isUpper).length >= 2) {
      mentions.push([m.index, m.index + m[0].length, "A", UNRESOLVED]);
      unresolved.push(token);
    }
  }

  const ends = clauseEnds(original, mentions);
  const clauses = new Map<number, [number, Kind, number | string][]>();
  for (const [start, , kind, value] of [...mentions].sort(compareMentions)) {
    const k = bisectLeft(ends, start);
    clauses.set(k, [...(clauses.get(k) ?? []), [start, kind, value]]);
  }

  const assignments = new Set<string>();
  let previousPeople: (number | string)[] = [];
  for (const [k, clause] of [...clauses].sort((a, b) => a[0] - b[0])) {
    const runs: [Kind, (number | string)[]][] = [];
    for (const [, kind, value] of clause) {
      const last = runs.at(-1);
      if (last && last[0] === kind) last[1].push(value);
      else runs.push([kind, [value]]);
    }
    // "A.B.: conceptualization; methodology": a clause of roles alone goes to the people before it,
    // unless it opens with a name the parser did not recognise.
    const leadIn = text.slice(k ? ends[k - 1] : 0, clause[0]?.[0]); // names found are masked
    if (runs.length === 1 && runs[0]?.[0] === "R" && previousPeople.length > 0 && !NAME_COLON_RE.test(leadIn)) {
      runs.unshift(["A", previousPeople]);
    }
    // A trailing run with no partner (authors named after the last roles) is dropped.
    for (let r = 0; r + 1 < runs.length; r += 2) {
      type Run = [Kind, (number | string)[]];
      const [lead, follow] = [runs[r], runs[r + 1]] as [Run, Run];
      const [people, slugs] = lead[0] === "A" ? [lead[1], follow[1]] : [follow[1], lead[1]];
      const indices = people.includes(ALL_AUTHORS)
        ? authors.map((_, i) => i)
        : people.filter((i) => i !== UNRESOLVED).map(Number);
      for (const i of indices) for (const slug of slugs) assignments.add(`${i} ${slug}`);
    }
    const peopleRuns = runs.filter(([kind]) => kind === "A");
    const lastPeople = peopleRuns.at(-1);
    if (lastPeople) previousPeople = lastPeople[1];
  }

  const roleOrder = (role: CreditRoleName) => CREDIT_ROLES.findIndex((r) => r.name === role);
  return {
    assignments: [...assignments]
      .map((pair) => {
        const [i, slug] = pair.split(" ");
        return { author: Number(i), role: ROLE_BY_SLUG.get(slug) as CreditRoleName };
      })
      .sort((a, b) => a.author - b.author || roleOrder(a.role) - roleOrder(b.role)),
    unresolved,
  };
}
