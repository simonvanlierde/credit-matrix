// spell-checker: ignore archivearticle, mathml

import type { Contributor, Group, Person } from "../author";
import { activeContributions, isAllBinary, isGroup, isPerson, normalizeOrcid, scoreToLevel } from "../author";
import { getRoleByName } from "../credit-roles";
import { cleanNamePart, isSuffix, splitCommaSuffix } from "../parse-authors";
import { escapeXml } from "./escape-xml";
import { GENERATOR_NOTE } from "./generator-note";

/** JATS versions the export writes. 1.4 wraps a group in `<collab-wrap>`; 1.3 has `<collab>` alone. */
export type JatsVersion = "1.3" | "1.4";

const DOCTYPES: Record<JatsVersion, string> = {
  "1.3":
    '<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD with MathML3 v1.3 20210610//EN" "JATS-archivearticle1-3-mathml3.dtd">',
  "1.4":
    '<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD with MathML3 v1.4 20241031//EN" "JATS-archivearticle1-4-mathml3.dtd">',
};

/**
 * Serialize authors to a JATS4R-compliant XML string.
 * Output mirrors the format produced by the original Python app.
 * With `yesNo` (the Yes/No input mode) and only 0/100 scores, roles have no
 * `degree-contribution`: the author never chose a level, so writing every role
 * as "lead" would claim one.
 */
export function toJats4rXml(
  authors: Contributor[],
  { yesNo = false, jatsVersion = "1.3" }: { yesNo?: boolean; jatsVersion?: JatsVersion } = {},
): string {
  const withLevels = !(yesNo && isAllBinary(authors));
  // JATS4R rejects equal-contrib on a single author: equal with whom? A lone
  // flag stays in JSON and CSV, where the draft round-trips, but not here.
  const sharedFirst =
    authors.filter((author) => isPerson(author) && author.equalContribution && author.contributorType !== "non-author")
      .length > 1;
  const memberGroups: string[] = [];
  const contributions = authors
    .map((author) => {
      if (!isGroup(author)) return authorToXml(author, sharedFirst, withLevels);
      const { contrib, after } = groupToXml(
        author,
        withLevels,
        jatsVersion,
        `collab-members-${memberGroups.length + 1}`,
      );
      if (after) memberGroups.push(after);
      return contrib;
    })
    .join("\n    ");

  return `<?xml version='1.0' encoding='UTF-8'?>
${DOCTYPES[jatsVersion]}
<!-- ${GENERATOR_NOTE} -->
<article article-type="other" dtd-version="${jatsVersion}">
  <front>
    <article-meta>
      <contrib-group>
    ${contributions}
      </contrib-group>${memberGroups.map((g) => `\n      ${g}`).join("")}
    </article-meta>
  </front>
  <body/>
</article>`;
}

/**
 * The given-names half of the display name. The parsed parts keep only the
 * first, second and last token, so rebuilding from them drops the rest
 * ("María José García López" → "María José López"). Take the name minus its surname
 * instead, unless complete stored parts describe a family-first name.
 */
export function givenNamesOf(author: Person): string {
  // The suffix goes in its own element, whichever order the name is in.
  const suffix = suffixOf(author);
  const [unsuffixed, commaSuffix] = splitCommaSuffix(author.name);
  const words = (suffix === commaSuffix ? unsuffixed : author.name).trim().split(/\s+/);
  if (suffix && suffix !== commaSuffix) words.pop();
  const name = words.join(" ");
  const { surname } = author;
  // A mononym or an ORCID placeholder: the whole name, so it re-imports as is.
  if (!surname) return name;
  const givenNames = [author.firstName, author.middleName].filter(Boolean).join(" ");
  // Complete family-first parts win when a given name also matches the surname.
  if (author.firstName && wordsOf(name).replaceAll(" ", "") === wordsOf(`${surname} ${givenNames}`).replaceAll(" ", ""))
    return givenNames;
  // Match whole words, as the parser cleaned them: "King Jr." ends in the surname "Jr",
  // and "Anna" does not end in the surname "na".
  const isSurname = (text: string) => text === surname || wordsOf(text) === wordsOf(surname);
  for (let i = words.length - 1; i > 0; i -= 1) {
    if (isSurname(words.slice(i).join(" "))) return words.slice(0, i).join(" ");
  }
  // Inverted input ("Curie, Marie").
  const comma = name.indexOf(",");
  if (comma > 0 && isSurname(name.slice(0, comma).trim())) return name.slice(comma + 1).trim();
  return author.middleName ? `${author.firstName} ${author.middleName}` : author.firstName;
}

/**
 * The generational suffix of the name ("Jr." in "Martin King Jr.", "King Jr., Martin"
 * or "King, Martin, Jr."), unless the surname already ends in it ("Jr", or
 * "King Jr." from another tool).
 */
export function suffixOf(author: Person): string {
  const [unsuffixed, commaSuffix] = splitCommaSuffix(author.name);
  if (commaSuffix) return wordsOf(unsuffixed.split(",")[0] ?? "") === wordsOf(author.surname) ? commaSuffix : "";
  const words = author.name.trim().split(/\s+/);
  const last = words.at(-1) ?? "";
  return words.length > 2 && isSuffix(last) && wordsOf(last) !== wordsOf(author.surname).split(" ").at(-1) ? last : "";
}

function wordsOf(text: string): string {
  return cleanNamePart(text).split(/\s+/).filter(Boolean).join(" ");
}

function authorToXml(author: Person, sharedFirst: boolean, withLevels: boolean): string {
  const givenNames = givenNamesOf(author);

  // JATS4R wants the full URI, not the bare iD.
  const orcidEl = author.orcid
    ? `\n      <contrib-id contrib-id-type="orcid">https://orcid.org/${escapeXml(normalizeOrcid(author.orcid))}</contrib-id>`
    : "";

  const roles = rolesToXml(author, withLevels);

  // Named authors use contrib-type="author"; people credited only in an
  // Acknowledgements section use the generic "contributor" (JATS contrib-type
  // is an open vocabulary).
  const contribType = author.contributorType === "non-author" ? "contributor" : "author";
  const suffix = suffixOf(author);

  // JATS stores both markers as attributes on <contrib>, outside the CRediT
  // vocabulary: the taxonomy has no term for either.
  const equalAttr = sharedFirst && author.equalContribution && contribType === "author" ? ' equal-contrib="yes"' : "";
  const correspAttr = author.corresponding ? ' corresp="yes"' : "";

  return `<contrib contrib-type="${contribType}"${equalAttr}${correspAttr}>${orcidEl}
      <string-name>
        <given-names>${escapeXml(givenNames)}</given-names>
        <surname>${escapeXml(author.surname)}</surname>${suffix ? `\n        <suffix>${escapeXml(suffix)}</suffix>` : ""}
      </string-name>
${roles}
    </contrib>`;
}

/** JATS 1.3 stores the level as `degree-contribution` (lead / equal / supporting); the exact 0-100 score within a level is not kept. */
function rolesToXml(contributor: Contributor, withLevels: boolean): string {
  return activeContributions(contributor)
    .map((c) => {
      const role = getRoleByName(c.role);
      const degree = withLevels ? ` degree-contribution="${scoreToLevel(c.score)}"` : "";
      return `        <role vocab="credit" vocab-identifier="https://credit.niso.org/" vocab-term="${escapeXml(c.role)}" vocab-term-identifier="${role.url}"${degree}>${escapeXml(c.role)}</role>`;
    })
    .join("\n");
}

/** A group's `<contrib>`, and its member `<contrib-group>` when that sits outside it (JATS 1.3). */
interface GroupXml {
  contrib: string;
  after: string;
}

/**
 * A group is a name, with the ROR id as a `<contrib-id>`, and members in a `<contrib-group>` whose
 * `content-type` says whether they are authors or collaborators. JATS 1.4 nests that group in a
 * `<collab-wrap>` beside the `<collab-name>`. JATS 1.3 cannot hold it inside the `<contrib>`, and the
 * JATS4R rules forbid a `<contrib>` inside a `<collab>`, so the members go in a `<contrib-group>`
 * after the main one, which the group's `<xref>` names. The alias and the links between members and
 * person rows stay in JSON.
 */
function groupToXml(group: Group, withLevels: boolean, version: JatsVersion, membersId: string): GroupXml {
  const rorEl = group.ror
    ? `\n      <contrib-id contrib-id-type="ror">https://ror.org/${escapeXml(group.ror)}</contrib-id>`
    : "";
  const members =
    group.members.length === 0
      ? ""
      : `<contrib-group id="${membersId}" content-type="${group.membersAre}">${group.members
          .map(
            (member) => `<contrib contrib-type="author"><string-name>${escapeXml(member.name)}</string-name></contrib>`,
          )
          .join("")}</contrib-group>`;
  const name = escapeXml(group.name);
  const nested = version === "1.4";
  const collab = nested
    ? `<collab-wrap><collab-name>${name}</collab-name>${members}</collab-wrap>`
    : `<collab>${name}</collab>`;
  const link = !nested && members ? `\n      <xref ref-type="other" rid="${membersId}"/>` : "";
  const contribType = group.contributorType === "non-author" ? "contributor" : "author";
  return {
    contrib: `<contrib contrib-type="${contribType}">${rorEl}
      ${collab}${link}
${rolesToXml(group, withLevels)}
    </contrib>`,
    after: nested ? "" : members,
  };
}
