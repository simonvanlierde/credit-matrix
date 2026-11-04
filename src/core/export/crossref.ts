import type { Author, Contribution } from "../author";
import { activeContributions, isValidOrcid, normalizeOrcid, ORCID_INPUT_REGEX } from "../author";
import { CREDIT_ROLES, getRoleByName } from "../credit-roles";
import { cleanNamePart, createAuthor, deduplicateAuthorInitials } from "../parse-authors";
import { escapeXml } from "./escape-xml";
import { GENERATOR_NOTE } from "./generator-note";
import { givenNamesOf, suffixOf } from "./xml";
import { parseXml, type XmlParser } from "./xml-import";

/**
 * The `<contributors>` block of a Crossref deposit (metadata schema 5.5.0 or
 * later), for a publisher to paste into the work's record. Each person gets a
 * Crossref role (`author`, or `other` for people credited only in the
 * Acknowledgements), `corresponding-author` where marked, and one CRediT role
 * per contribution above zero. The schema has no slot for a contribution level
 * or for equal contribution, so neither is written. The ORCID iD is never
 * marked `authenticated`: only the depositing member can vouch for that.
 * Authors come first, then the others, each in roster order. A row still named
 * after its ORCID iD has no name to deposit, so it is left out with a comment.
 */
export function toCrossrefContributors(authors: Author[]): string {
  const isAuthor = (author: Author) => author.contributorType !== "non-author";
  const ordered = [...authors.filter(isAuthor), ...authors.filter((author) => !isAuthor(author))];
  const unnamed = (author: Author) => ORCID_INPUT_REGEX.test(author.name.trim());
  const named = ordered.filter((author) => !unnamed(author));
  const firstAuthor = named.find(isAuthor);
  const people = [
    ...ordered
      .filter(unnamed)
      .map((author) => `  <!-- Left out: ${escapeXml(normalizeOrcid(author.name.trim()))} has no name yet. -->`),
    ...named.map((author) => personToXml(author, author === firstAuthor)),
  ].join("\n");
  return `<!-- ${GENERATOR_NOTE} · Crossref schema 5.5.0 -->
<contributors>
${people}
</contributors>`;
}

function personToXml(author: Author, first: boolean): string {
  // Crossref wants a single name in <surname>.
  const surname = author.surname || author.name.trim();
  const given = author.surname ? givenNamesOf(author) : "";
  const lines = [
    ...(given ? [`<given_name>${escapeXml(given)}</given_name>`] : []),
    `<surname>${escapeXml(surname)}</surname>`,
    ...(suffixOf(author) ? [`<suffix>${escapeXml(suffixOf(author))}</suffix>`] : []),
    `<role vocab="crossref" type="${author.contributorType === "non-author" ? "other" : "author"}"/>`,
    ...(author.corresponding ? ['<role vocab="crossref" type="corresponding-author"/>'] : []),
    // Crossref's CRediT values are the slugs of the credit.niso.org role URLs.
    ...activeContributions(author).map((c) => `<role vocab="credit" type="${creditSlug(getRoleByName(c.role).url)}"/>`),
    ...(author.orcid ? [`<ORCID>https://orcid.org/${escapeXml(normalizeOrcid(author.orcid))}</ORCID>`] : []),
  ];
  return `  <person_name sequence="${first ? "first" : "additional"}">
${lines.map((line) => `    ${line}`).join("\n")}
  </person_name>`;
}

/** The slug Crossref uses for a CRediT role: the last path part of its credit.niso.org URL. */
const creditSlug = (url: string) => url.split("/").at(-2);

/** Whether text opens with a Crossref `<contributors>` block, after any leading comments. */
export function isCrossrefContributors(text: string): boolean {
  return /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<contributors[\s>]/.test(text.trim());
}

const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Read a `<contributors>` block written by {@link toCrossrefContributors} back into authors.
 * The block holds no contribution levels, so every listed CRediT role comes back as lead.
 * Same safety rules and `parser` as `fromJats4rXml`.
 */
export function fromCrossrefContributors(xml: string, { parser }: { parser?: XmlParser } = {}): Author[] {
  const doc = parseXml(xml, parser, "fromCrossrefContributors");
  const roleBySlug = new Map(CREDIT_ROLES.map((r) => [creditSlug(r.url), r.name]));
  const authors = Array.from(doc.querySelectorAll("person_name")).flatMap((person) => {
    const given = squash(person.querySelector("given_name")?.textContent);
    const surname = squash(person.querySelector("surname")?.textContent);
    const suffix = squash(person.querySelector("suffix")?.textContent);
    const displayName = [given, surname, suffix].filter(Boolean).join(" ");
    if (!displayName) return [];
    const roles = Array.from(person.querySelectorAll("role"));
    const typesOf = (vocab: string) =>
      roles.filter((r) => r.getAttribute("vocab") === vocab).map((r) => r.getAttribute("type") ?? "");
    const crossref = typesOf("crossref");
    const credited = new Set(typesOf("credit"));
    const contributions: Contribution[] = CREDIT_ROLES.map((r) => ({
      role: r.name,
      score: credited.has(creditSlug(r.url) ?? "") ? 100 : 0,
    }));
    const givenParts = cleanNamePart(given).split(/\s+/).filter(Boolean);
    const orcid = normalizeOrcid(squash(person.querySelector("ORCID")?.textContent));
    try {
      return [
        createAuthor(displayName, {
          contributions,
          contributorType: crossref.includes("other") && !crossref.includes("author") ? "non-author" : "author",
          corresponding: crossref.includes("corresponding-author"),
          ...(given && surname ? { firstName: givenParts[0], middleName: givenParts[1] ?? "", surname } : {}),
          ...(orcid && isValidOrcid(orcid) ? { orcid } : {}),
        }),
      ];
    } catch {
      return [];
    }
  });
  return deduplicateAuthorInitials(authors);
}
