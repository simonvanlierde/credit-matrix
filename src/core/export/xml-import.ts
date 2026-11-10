import type { Author, Contribution } from "../author";
import { isValidOrcid, LEVEL_SCORE, normalizeOrcid } from "../author";
import { CREDIT_ROLES, roleNamed } from "../credit-roles";
import { cleanNamePart, createAuthor, deduplicateAuthorInitials } from "../parse-authors";

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
  const doc = parseXml(xmlString, parser, "fromJats4rXml");

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

    const contributorType = contribType === "contributor" ? "non-author" : "author";
    // JATS spells both markers "yes"; anything else, including absence, is no.
    const equalContribution = contrib.getAttribute("equal-contrib") === "yes";
    const corresponding = contrib.getAttribute("corresp") === "yes";

    const person = readPerson(
      {
        given: contrib.querySelector("given-names")?.textContent,
        surname: contrib.querySelector("surname")?.textContent,
        suffix: contrib.querySelector("suffix")?.textContent,
        // The iD is a full URI (JATS4R) or bare (older exports); state keeps it bare.
        // biome-ignore lint/security/noSecrets: this is a CSS attribute selector, not a credential.
        orcid: contrib.querySelector('contrib-id[contrib-id-type="orcid"]')?.textContent,
      },
      { contributions, contributorType, equalContribution, corresponding },
    );
    return person ? [person] : [];
  });

  return deduplicateAuthorInitials(authors);
}

/** Text that is not well-formed XML, such as a truncated file. */
export class XmlParseError extends Error {
  override name = "XmlParseError";
}

/**
 * Parse untrusted XML text. Both exporters write plain documents with no entities. Browsers expand
 * them and linkedom does not, so the app and the CLI would read different names, and a nested
 * expansion can freeze the tab.
 */
export function parseXml(xmlString: string, parser: XmlParser | undefined, caller: string) {
  if (/<!(ENTITY|ATTLIST)/i.test(xmlString)) {
    throw new Error("XML parse error: entity and attribute-list declarations are not supported.");
  }
  if (!parser && typeof DOMParser === "undefined") {
    throw new Error(`${caller} needs a DOMParser: pass { parser } where there is no global one.`);
  }
  const doc = (parser ?? new DOMParser()).parseFromString(xmlString, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new XmlParseError(`XML parse error: ${parseError.textContent?.trim() ?? "invalid XML"}`);
  }
  return doc;
}

/** Compare role URLs regardless of scheme, case and trailing slash. */
function normalizeRoleUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Build one author from the name and ORCID text a reader found. Squashes the whitespace pretty-printed
 * XML leaves in a name, hands the parts over pre-split so a double surname survives, and drops an
 * unparseable ORCID. Returns null for a nameless or rejected entry, so one bad person never aborts the import.
 */
export function readPerson(
  text: { given?: string | null; surname?: string | null; suffix?: string | null; orcid?: string | null },
  overrides: Partial<Pick<Author, "contributions" | "contributorType" | "equalContribution" | "corresponding">>,
): Author | null {
  const given = squash(text.given);
  const surname = squash(text.surname);
  const displayName = [given, surname, squash(text.suffix)].filter(Boolean).join(" ");
  if (!displayName) return null;
  // Same split as `parseNameParts` makes for its comma branch: first token first name, second middle name.
  const [first = "", middle = ""] = cleanNamePart(given).split(/\s+/).filter(Boolean);
  const orcid = normalizeOrcid(squash(text.orcid));
  try {
    return createAuthor(displayName, {
      ...overrides,
      ...(given && surname ? { firstName: first, middleName: middle, surname } : {}),
      ...(orcid && isValidOrcid(orcid) ? { orcid } : {}),
    });
  } catch {
    return null;
  }
}
