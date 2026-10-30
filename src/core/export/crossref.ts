import type { Author } from "../author";
import { activeContributions, normalizeOrcid, ORCID_INPUT_REGEX } from "../author";
import { getRoleByName } from "../credit-roles";
import { escapeXml } from "./escape-xml";
import { GENERATOR_NOTE } from "./generator-note";
import { givenNamesOf, suffixOf } from "./xml";

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
    ...activeContributions(author).map(
      (c) => `<role vocab="credit" type="${getRoleByName(c.role).url.split("/").at(-2)}"/>`,
    ),
    ...(author.orcid ? [`<ORCID>https://orcid.org/${escapeXml(normalizeOrcid(author.orcid))}</ORCID>`] : []),
  ];
  return `  <person_name sequence="${first ? "first" : "additional"}">
${lines.map((line) => `    ${line}`).join("\n")}
  </person_name>`;
}
