import type { Author, Contribution } from "../author";
import { isValidOrcid, LEVEL_SCORE, normalizeOrcid } from "../author";
import { CREDIT_ROLES, roleNamed } from "../credit-roles";
import { createAuthor, deduplicateAuthorInitials } from "../parse-authors";

/** The score each `degree-contribution` level imports as. "none" is not one: a listed role counts. */
const LEVEL_SCORES = new Map<string, number>(Object.entries(LEVEL_SCORE).filter(([level]) => level !== "none"));

/** The part of a DOM element the importer reads. Browser and linkedom elements both fit. */
export interface XmlElement {
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selectors: string): XmlElement | null;
  querySelectorAll(selectors: string): ArrayLike<XmlElement>;
}

/** A `DOMParser`: the browser's own, or linkedom's in Node. */
export interface XmlParser {
  parseFromString(xml: string, type: "application/xml"): Pick<XmlElement, "querySelector" | "querySelectorAll">;
}

/**
 * Parse a JATS4R XML string (as produced by `toJats4rXml()` or the original
 * Python app) back into an Author array. `parser` defaults to the global
 * `DOMParser`; pass one where there is none, such as linkedom's in Node.
 */
export function fromJats4rXml(xmlString: string, { parser }: { parser?: XmlParser } = {}): Author[] {
  if (!parser && typeof DOMParser === "undefined") {
    throw new Error("fromJats4rXml needs a DOMParser: pass { parser } where there is no global one.");
  }
  const doc = (parser ?? new DOMParser()).parseFromString(xmlString, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`XML parse error: ${parseError.textContent?.trim() ?? "invalid XML"}`);
  }

  const roleNameByUrl = new Map<string, string>(CREDIT_ROLES.map((r) => [normalizeRoleUrl(r.url), r.name]));

  const contribEls = Array.from(doc.querySelectorAll("contrib"));
  if (contribEls.length === 0) return [];

  const authors = contribEls.flatMap((contrib) => {
    // Editors, reviewers and other non-credited contrib types are not authors.
    const contribType = contrib.getAttribute("contrib-type");
    if (contribType && contribType !== "author" && contribType !== "contributor") return [];
    // A <collab> with members holds their contribs: they import on their own,
    // and reading the group would pick up the first member's name again.
    if (contrib.querySelector("contrib")) return [];

    const givenNamesEl = contrib.querySelector("given-names");
    const surnameEl = contrib.querySelector("surname");

    // Pretty-printed XML can leave line breaks and indentation inside a name.
    const givenNames = (givenNamesEl?.textContent ?? "").replace(/\s+/g, " ").trim();
    const surname = (surnameEl?.textContent ?? "").replace(/\s+/g, " ").trim();

    const displayName = [givenNames, surname].filter(Boolean).join(" ");
    // Split given names the same way `parseNameParts` does for its comma branch:
    // first token is the first name, the second (if any) is the middle name.
    const givenParts = givenNames.split(/\s+/).filter(Boolean);
    const givenFirst = givenParts[0] ?? "";
    const givenMiddle = givenParts[1] ?? "";
    // Skip nameless contribs (e.g. a <collab> group, or a malformed entry)
    // rather than throwing and discarding every other valid author.
    if (!displayName) return [];

    // Parse role elements. The `vocab-term-identifier` URL is authoritative; then
    // `vocab-term`, then the text content, read whatever their case or dash
    // ("Writing - original draft").
    const roleEls = Array.from(contrib.querySelectorAll("role"));
    const scoreByRole = new Map<string, number>();
    for (const el of roleEls) {
      const name =
        roleNameByUrl.get(normalizeRoleUrl(el.getAttribute("vocab-term-identifier") ?? "")) ??
        roleNamed(el.getAttribute("vocab-term") ?? "") ??
        roleNamed(el.textContent ?? "");
      if (!name) continue;
      // No or an unknown `degree-contribution` (JATS before 1.3) means lead.
      const score = LEVEL_SCORES.get(el.getAttribute("degree-contribution")?.trim().toLowerCase() ?? "") ?? 100;
      scoreByRole.set(name, Math.max(score, scoreByRole.get(name) ?? 0));
    }

    const contributions: Contribution[] = CREDIT_ROLES.map((r) => ({
      role: r.name,
      score: scoreByRole.get(r.name) ?? 0,
    }));

    // The iD is a full URI (JATS4R) or bare (older exports); state keeps it bare.
    // biome-ignore lint/security/noSecrets: this is a CSS attribute selector, not a credential.
    const orcidEl = contrib.querySelector('contrib-id[contrib-id-type="orcid"]');
    const orcid = normalizeOrcid(orcidEl?.textContent?.trim() ?? "");
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
