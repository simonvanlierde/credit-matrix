// spell-checker: ignore archivearticle, mathml

import type { Author } from "../author";
import { activeContributions, scoreToLevel } from "../author";
import { getRoleByName } from "../credit-roles";
import { escapeXml } from "./escape-xml";
import { GENERATOR_NOTE } from "./generator-note";

const DOCTYPE =
  '<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD with MathML3 v1.3 20210610//EN" "JATS-archivearticle1-3-mathml3.dtd">';

/**
 * Serialize authors to a JATS4R-compliant XML string.
 * Output mirrors the format produced by the original Python app.
 */
export function toJats4rXml(authors: Author[]): string {
  const contributions = authors.map(authorToXml).join("\n    ");

  return `<?xml version='1.0' encoding='UTF-8'?>
${DOCTYPE}
<!-- ${GENERATOR_NOTE} -->
<article article-type="other" dtd-version="1.3">
  <front>
    <article-meta>
      <contrib-group>
    ${contributions}
      </contrib-group>
    </article-meta>
  </front>
  <body/>
</article>`;
}

/**
 * The given-names half of the display name. The parsed parts keep only the
 * first, second and last token, so rebuilding from them drops the rest
 * ("Anne van der Berg" → "Anne van Berg"). Take the name minus its surname
 * instead.
 */
function givenNamesOf(author: Author): string {
  const name = author.name.trim();
  const { surname } = author;
  // A mononym or an ORCID placeholder: the whole name, so it re-imports as is.
  if (!surname) return name;
  if (name.endsWith(surname)) return name.slice(0, -surname.length).trim();
  // Inverted input ("Curie, Marie").
  if (name.startsWith(`${surname},`)) return name.slice(surname.length + 1).trim();
  return author.middleName ? `${author.firstName} ${author.middleName}` : author.firstName;
}

function authorToXml(author: Author): string {
  const givenNames = givenNamesOf(author);

  // JATS4R wants the full URI, not the bare iD.
  const orcidEl = author.orcid
    ? `\n      <contrib-id contrib-id-type="orcid">https://orcid.org/${escapeXml(author.orcid)}</contrib-id>`
    : "";

  // JATS 1.3 carries the level as `degree-contribution` (lead / equal /
  // supporting); the exact 0–100 score within a level is not kept.
  const roles = activeContributions(author)
    .map((c) => {
      const role = getRoleByName(c.role);
      return `        <role vocab="credit" vocab-identifier="https://credit.niso.org/" vocab-term="${escapeXml(c.role)}" vocab-term-identifier="${role.url}" degree-contribution="${scoreToLevel(c.score)}">${escapeXml(c.role)}</role>`;
    })
    .join("\n");

  // Named authors use contrib-type="author"; people credited only in an
  // Acknowledgements section use the generic "contributor" (JATS contrib-type
  // is an open vocabulary).
  const contribType = author.contributorType === "non-author" ? "contributor" : "author";

  // JATS carries both markers as attributes on <contrib>, outside the CRediT
  // vocabulary: the taxonomy has no term for either.
  const equalAttr = author.equalContribution ? ' equal-contrib="yes"' : "";
  const correspAttr = author.corresponding ? ' corresp="yes"' : "";

  return `<contrib contrib-type="${contribType}"${equalAttr}${correspAttr}>${orcidEl}
      <string-name>
        <given-names>${escapeXml(givenNames)}</given-names>
        <surname>${escapeXml(author.surname)}</surname>
      </string-name>
${roles}
    </contrib>`;
}
