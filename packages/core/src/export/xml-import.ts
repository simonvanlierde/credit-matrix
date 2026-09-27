import type { Author, Contribution } from "../author";
import { isValidOrcid } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { createAuthor, deduplicateAuthorInitials } from "../parse-authors";

/**
 * Parse a JATS4R XML string (as produced by `toJats4rXml()` or the original
 * Python app) back into an Author array.
 *
 * Runs in both browser (DOMParser) and Node (requires a DOM; see note below).
 *
 * Node note: this function uses the global `DOMParser`. In Node ≥ 19 there is
 * no built-in DOMParser, so callers that need server-side XML import should
 * pass in a pre-parsed Document via the overloaded `fromXmlDocument()` helper,
 * or use a lightweight DOM library such as `linkedom`.
 * In the browser this just works.
 */
export function fromJats4rXml(xmlString: string): Author[] {
  if (typeof DOMParser === "undefined") {
    throw new Error(
      "DOMParser is not available in this environment. " +
        "Use fromXmlDocument() with a server-side DOM parser instead.",
    );
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`XML parse error: ${parseError.textContent?.trim() ?? "invalid XML"}`);
  }

  return fromXmlDocument(doc);
}

/**
 * Extract authors from a pre-parsed XML Document.
 * Works in any environment: pass the Document from whatever DOM library you use.
 */
export function fromXmlDocument(doc: Document): Author[] {
  const roleNames = new Set<string>(CREDIT_ROLES.map((r) => r.name));
  const roleNameByUrl = new Map<string, string>(CREDIT_ROLES.map((r) => [normalizeRoleUrl(r.url), r.name]));

  const contribEls = Array.from(doc.querySelectorAll("contrib"));
  if (contribEls.length === 0) return [];

  const authors = contribEls.flatMap((contrib) => {
    // Editors, reviewers and other non-credited contrib types are not authors.
    const contribType = contrib.getAttribute("contrib-type");
    if (contribType && contribType !== "author" && contribType !== "contributor") return [];

    const givenNamesEl = contrib.querySelector("given-names");
    const surnameEl = contrib.querySelector("surname");

    const givenNames = givenNamesEl?.textContent?.trim() ?? "";
    const surname = surnameEl?.textContent?.trim() ?? "";

    const displayName = [givenNames, surname].filter(Boolean).join(" ");
    // Split given names the same way `parseNameParts` does for its comma branch:
    // first token is the first name, the second (if any) is the middle name.
    const givenParts = givenNames.split(/\s+/).filter(Boolean);
    const givenFirst = givenParts[0] ?? "";
    const givenMiddle = givenParts[1] ?? "";
    // Skip nameless contribs (e.g. a <collab> group, or a malformed entry)
    // rather than throwing and discarding every other valid author.
    if (!displayName) return [];

    // Parse role elements. The `vocab-term-identifier` URL is authoritative, as
    // term spellings vary ("Writing - original draft"); then `vocab-term`, then
    // the text content.
    const roleEls = Array.from(contrib.querySelectorAll("role"));
    const activeRoleNames = new Set(
      roleEls
        .map(
          (el) =>
            roleNameByUrl.get(normalizeRoleUrl(el.getAttribute("vocab-term-identifier") ?? "")) ??
            el.getAttribute("vocab-term") ??
            el.textContent?.trim() ??
            "",
        )
        .filter((name) => roleNames.has(name)),
    );

    // JATS4R carries no score, only role presence, so every active role comes
    // back as 100. A score of e.g. 50 exported to XML re-imports as 100; this
    // lossy round-trip is by design (the format has no field for it).
    const contributions: Contribution[] = CREDIT_ROLES.map((r) => ({
      role: r.name,
      score: activeRoleNames.has(r.name) ? 100 : 0,
    }));

    // Try to read ORCID from an `<contrib-id contrib-id-type="orcid">` element
    // biome-ignore lint/security/noSecrets: this is a CSS attribute selector, not a credential.
    const orcidEl = contrib.querySelector('contrib-id[contrib-id-type="orcid"]');
    const orcid = orcidEl?.textContent?.trim() ?? "";
    const contributorType = contribType === "contributor" ? "non-author" : "author";
    // JATS spells both markers "yes"; anything else, including absence, is no.
    const equalContribution = contrib.getAttribute("equal-contrib") === "yes";
    const corresponding = contrib.getAttribute("corresp") === "yes";

    // Skip a rejected contrib (e.g. a name with no letters) rather than
    // aborting the whole import.
    try {
      return [
        createAuthor(displayName, {
          contributions,
          contributorType,
          equalContribution,
          corresponding,
          // JATS already separates the parts, so hand them over instead of
          // letting the parser re-split `displayName`, which would read a particle
          // surname ("van der Berg") back as middle name "van" + surname "Berg".
          ...(givenNames && surname ? { firstName: givenFirst, middleName: givenMiddle, surname } : {}),
          // Drop an unparseable ORCID rather than aborting the whole import.
          ...(orcid && isValidOrcid(orcid) ? { orcid } : {}),
        }),
      ];
    } catch {
      return [];
    }
  });

  return deduplicateAuthorInitials(authors);
}

/** Compare role URLs regardless of scheme, case and trailing slash. */
function normalizeRoleUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}
