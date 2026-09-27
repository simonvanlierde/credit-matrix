// spell-checker: ignore archivearticle, mathml

import type { Author } from "../author";
import { activeContributions } from "../author";
import { getRoleByName } from "../credit-roles";
import { escapeXml } from "./escape-xml";
import { GENERATOR_NOTE } from "./generator-note";

const DOCTYPE =
  '<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD with MathML3 v1.2 20190208//EN" "JATS-archivearticle1-mathml3.dtd">';

/**
 * Serialize authors to a JATS4R-compliant XML string.
 * Output mirrors the format produced by the original Python app.
 */
export function toJats4rXml(authors: Author[]): string {
  const contributions = authors.map(authorToXml).join("\n    ");

  return `<?xml version='1.0' encoding='UTF-8'?>
${DOCTYPE}
<!-- ${GENERATOR_NOTE} -->
<article xmlns:xlink="http://www.w3.org/1999/xlink"
         xmlns:ali="http://www.niso.org/schemas/ali/1.0/"
         article-type="other"
         dtd-version="1.2">
  <front>
    <article-meta>
      <contrib-group>
    ${contributions}
      </contrib-group>
      <permissions>
        <copyright-statement>© 2019 JATS4R</copyright-statement>
        <copyright-year>2019</copyright-year>
        <copyright-holder>JATS4R</copyright-holder>
        <license xmlns:ali="http://www.niso.org/schemas/ali/1.0/">
          <ali:license_ref>http://creativecommons.org/licenses/by/4.0/</ali:license_ref>
          <license-p>This is an open access article distributed under the terms of the<ext-link xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="http://creativecommons.org/licenses/by/4.0/" ext-link-type="uri">Creative Commons Attribution License</ext-link>, which permits unrestricted use, distribution, and reproduction in any medium, provided the original author and source are credited.</license-p>
        </license>
      </permissions>
    </article-meta>
  </front>
  <body/>
</article>`;
}

/**
 * The given-names half of the display name. The parsed parts keep only the
 * first, second and last token, so rebuilding from them drops the rest
 * ("Anne van der Berg" → "Anne van Berg"); take the name minus its surname.
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

  const orcidEl = author.orcid
    ? `\n      <contrib-id contrib-id-type="orcid">${escapeXml(author.orcid)}</contrib-id>`
    : "";

  // JATS4R encodes role presence only; the 0–100 score is not representable,
  // so an export→import round-trip is lossy (see fromXmlDocument).
  const roles = activeContributions(author)
    .map((c) => {
      const role = getRoleByName(c.role);
      return `        <role vocab="credit" vocab-identifier="https://credit.niso.org/" vocab-term="${escapeXml(c.role)}" vocab-term-identifier="${role.url}">${escapeXml(c.role)}</role>`;
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
