import type { Contribution, Contributor, Group, Person } from "../author";
import { activeContributions, isGroup, normalizeOrcid, ORCID_INPUT_REGEX } from "../author";
import { CREDIT_ROLES, creditSlug, getRoleByName } from "../credit-roles";
import { createGroup, deduplicateAuthorInitials, readUpToCap } from "../parse-authors";
import { escapeXml } from "./escape-xml";
import { GENERATOR_NOTE } from "./generator-note";
import { givenNamesOf, suffixOf } from "./xml";
import { parseXml, readPerson, type XmlElement, type XmlParser } from "./xml-import";

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
 * A group is an `<organization>`: Crossref gives it no CRediT roles and no "other" role, so its roles
 * are dropped with a comment, and a group credited only in the Acknowledgements is left out with one.
 */
export function toCrossrefContributors(authors: Contributor[]): string {
  const isAuthor = (author: Contributor) => author.contributorType !== "non-author";
  const ordered = [...authors.filter(isAuthor), ...authors.filter((author) => !isAuthor(author))];
  const unnamed = (author: Contributor) => !isGroup(author) && ORCID_INPUT_REGEX.test(author.name.trim());
  const unplaceable = (author: Contributor) => isGroup(author) && !isAuthor(author);
  const named = ordered.filter((author) => !unnamed(author) && !unplaceable(author));
  const firstAuthor = named.find(isAuthor);
  const people = [
    ...ordered
      .filter(unnamed)
      .map((author) => `  <!-- Left out: ${escapeXml(normalizeOrcid(author.name.trim()))} has no name yet. -->`),
    ...ordered
      .filter(unplaceable)
      .map(
        (author) =>
          `  <!-- Left out: ${escapeXml(author.name)} is a group credited only in the Acknowledgements, and Crossref has no such role for an organization. -->`,
      ),
    ...named.map((author) =>
      isGroup(author) ? organizationToXml(author, author === firstAuthor) : personToXml(author, author === firstAuthor),
    ),
  ].join("\n");
  return `<!-- ${GENERATOR_NOTE} · Crossref schema 5.5.0 -->
<contributors>
${people}
</contributors>`;
}

function organizationToXml(group: Group, first: boolean): string {
  const roles = activeContributions(group).map((c) => c.role);
  const dropped =
    roles.length > 0
      ? `  <!-- Roles of ${escapeXml(group.name)} dropped: Crossref gives an organization no CRediT roles (${escapeXml(roles.join("; "))}). -->\n`
      : "";
  return `${dropped}  <organization sequence="${first ? "first" : "additional"}" contributor_role="author">${escapeXml(group.name)}</organization>`;
}

function personToXml(author: Person, first: boolean): string {
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

/** Whether text opens with a Crossref `<contributors>` block, after any BOM, XML declaration and comments. */
export function isCrossrefContributors(text: string): boolean {
  // Plain indexOf steps, not one regex: comment bodies cannot cross `-->`, so matching stays linear.
  let rest = text.replace(/^\uFEFF/, "").trim();
  if (rest.startsWith("<?xml")) {
    const end = rest.indexOf("?>");
    if (end < 0) return false;
    rest = rest.slice(end + 2).trimStart();
  }
  while (rest.startsWith("<!--")) {
    const end = rest.indexOf("-->", 4);
    if (end < 0) return false;
    rest = rest.slice(end + 3).trimStart();
  }
  return /^<contributors[\s/>]/.test(rest);
}

/**
 * Read a `<contributors>` block written by {@link toCrossrefContributors} back into authors.
 * The block holds no contribution levels, so every listed CRediT role comes back as lead.
 * The display name is rebuilt as given name + surname + suffix, as `fromJats4rXml` does,
 * so a family-first name such as "Hopper, Grace" comes back as "Grace Hopper".
 * Same safety rules and `parser` as `fromJats4rXml`.
 */
export function fromCrossrefContributors(xml: string, { parser }: { parser?: XmlParser } = {}): Contributor[] {
  const doc = parseXml(xml, parser, "fromCrossrefContributors");
  const authors = readUpToCap<XmlElement, Contributor>(
    Array.from(doc.querySelectorAll("person_name, organization")),
    (person) => {
      if (person.localName === "organization") {
        const name = (person.textContent ?? "").replace(/\s+/g, " ").trim();
        try {
          return name ? [createGroup(name)] : [];
        } catch {
          return [];
        }
      }
      // Mirrors the JATS reader skipping nested contribs: a wrapper's own text would repeat its members, and the scan is quadratic.
      if (person.querySelector("person_name")) return [];
      const roles = Array.from(person.querySelectorAll("role"));
      const typesOf = (vocab: string) =>
        roles.filter((r) => r.getAttribute("vocab") === vocab).map((r) => r.getAttribute("type") ?? "");
      const crossref = typesOf("crossref");
      const credited = new Set(typesOf("credit"));
      const contributions: Contribution[] = CREDIT_ROLES.map((r) => ({
        role: r.name,
        score: credited.has(creditSlug(r.url)) ? 100 : 0,
      }));
      const author = readPerson(
        {
          given: person.querySelector("given_name")?.textContent,
          surname: person.querySelector("surname")?.textContent,
          suffix: person.querySelector("suffix")?.textContent,
          orcid: person.querySelector("ORCID")?.textContent,
        },
        {
          contributions,
          contributorType: crossref.includes("other") && !crossref.includes("author") ? "non-author" : "author",
          corresponding: crossref.includes("corresponding-author"),
        },
      );
      return author ? [author] : [];
    },
  );
  return deduplicateAuthorInitials(authors);
}
