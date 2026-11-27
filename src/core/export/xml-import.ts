import type { Contribution, Contributor, Member, Person } from "../author";
import { isValidOrcid, isValidRor, LEVEL_SCORE, MAX_GROUP_MEMBERS, normalizeOrcid, normalizeRor } from "../author";
import { CREDIT_ROLES, roleNamed } from "../credit-roles";
import { cleanNamePart, createAuthor, createGroup, deduplicateAuthorInitials, readUpToCap } from "../parse-authors";

/** The score each `degree-contribution` level imports as. "none" is not one: a listed role counts. */
const LEVEL_SCORES = new Map<string, number>(Object.entries(LEVEL_SCORE).filter(([level]) => level !== "none"));

/** The part of a DOM element the importer reads. Browser and linkedom elements both fit. */
export interface XmlElement {
  readonly textContent: string | null;
  /** Browser and linkedom elements have both. Without `localName` a Crossref `<organization>` reads as nothing. */
  readonly localName?: string;
  /** A group's name is the text of its `<collab>` outside the member list. */
  readonly childNodes?: ArrayLike<XmlNode>;
  getAttribute(name: string): string | null;
  querySelector(selectors: string): XmlElement | null;
  querySelectorAll(selectors: string): ArrayLike<XmlElement>;
}

/** A DOM node: text is `nodeType` 3, an element 1. */
export interface XmlNode {
  readonly nodeType: number;
  readonly textContent: string | null;
  readonly localName?: string;
  readonly childNodes?: ArrayLike<XmlNode>;
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
export function fromJats4rXml(xmlString: string, { parser }: { parser?: XmlParser } = {}): Contributor[] {
  const doc = parseXml(xmlString, parser, "fromJats4rXml");

  const roleNameByUrl = new Map<string, string>(CREDIT_ROLES.map((r) => [normalizeRoleUrl(r.url), r.name]));

  const contribEls = Array.from(doc.querySelectorAll("contrib"));
  if (contribEls.length === 0) return [];

  // A group's members belong to the group, not the list: contribs nested in the group's own contrib
  // (1.4 <collab-wrap>, or a <collab> from older files), or in the <contrib-group> its <xref> names (1.3).
  const groupsById = new Map(
    Array.from(doc.querySelectorAll("contrib-group")).map((group) => [group.getAttribute("id"), group]),
  );
  const holderOf = (contrib: XmlElement): XmlElement | undefined => {
    const rid = contrib.querySelector('xref[ref-type="other"]')?.getAttribute("rid");
    return (rid ? groupsById.get(rid) : undefined) ?? contrib.querySelector("contrib-group") ?? undefined;
  };
  // Each member list is read once: many group contribs may name one list, and a nested group's list
  // is already inside its parent's. Reading it per group contrib is N*M on a crafted file.
  const listed = new Map<XmlElement, XmlElement[]>();
  const memberEls = new Set<XmlElement>();
  for (const contrib of contribEls) {
    // Only a contrib that names a group has members; a file of people at the byte cap skips the lookups.
    if (memberEls.has(contrib) || !contrib.querySelector("collab, collab-name")) continue;
    const holder = holderOf(contrib);
    if (!holder || listed.has(holder)) continue;
    const els = Array.from(holder.querySelectorAll("contrib"));
    listed.set(holder, els);
    for (const el of els) memberEls.add(el);
  }
  const membersOf = (holder: XmlElement): Member[] => {
    const names: Member[] = [];
    for (const member of listed.get(holder) ?? []) {
      if (names.length >= MAX_GROUP_MEMBERS) break;
      const parts = ["given-names", "surname", "suffix"].map((tag) => squash(member.querySelector(tag)?.textContent));
      const text = parts.some(Boolean)
        ? parts.filter(Boolean).join(" ")
        : squash(member.querySelector("string-name")?.textContent ?? member.querySelector("name")?.textContent);
      if (text) names.push({ name: text });
    }
    return names;
  };
  // The cleaned member list of each holder: `createGroup` cleans it for the first group that names
  // it, and the others share it, so many groups naming one long list cost one pass.
  const cleanedByHolder = new Map<XmlElement, Member[]>();
  const authors = readUpToCap<XmlElement, Contributor>(contribEls, (contrib) => {
    if (memberEls.has(contrib)) return [];
    // Editors, reviewers and other non-credited contrib types are not authors.
    const contribType = contrib.getAttribute("contrib-type");
    if (contribType && contribType !== "author" && contribType !== "contributor") return [];
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

    const collab = contrib.querySelector("collab-name") ?? contrib.querySelector("collab");
    if (collab) {
      // JATS 1.3 has <collab> in the contrib; 1.4 wraps a <collab-name> and the member list in <collab-wrap>.
      const name = squash(textOutsideMembers(collab));
      if (!name) return [];
      const holder = holderOf(contrib);
      const cleaned = holder && cleanedByHolder.get(holder);
      const ror = normalizeRor(squash(contrib.querySelector('contrib-id[contrib-id-type="ror"]')?.textContent));
      try {
        const group = createGroup(name, {
          contributions,
          contributorType,
          members: cleaned || !holder ? [] : membersOf(holder),
          membersAre: holder?.getAttribute("content-type") === "authors" ? "authors" : "collaborators",
          ...(ror && isValidRor(ror) ? { ror } : {}),
        });
        if (!cleaned) {
          if (holder) cleanedByHolder.set(holder, group.members);
          return [group];
        }
        return [{ ...group, members: cleaned }];
      } catch {
        return [];
      }
    }

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

/** Elements whose text is not part of a group's name: its member list and the xref to it. */
const NOT_THE_NAME = new Set(["contrib-group", "contrib", "xref"]);

/** The text of a `<collab>` or `<collab-name>`, inline markup such as `<italic>` included. */
function textOutsideMembers(node: Omit<XmlNode, "nodeType">): string {
  if (!node.childNodes) return node.textContent ?? "";
  return Array.from(node.childNodes, (child) => {
    if (child.nodeType === 3) return child.textContent ?? "";
    // A space where a skipped element was, so the words on either side stay apart.
    if (child.nodeType !== 1 || NOT_THE_NAME.has(child.localName ?? "")) return " ";
    return textOutsideMembers(child);
  }).join("");
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
    .replace(/(?<!\/)\/+$/, ""); // the lookbehind tries each run of slashes once, not from every slash
}

const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Build one author from the name and ORCID text a reader found. Squashes the whitespace pretty-printed
 * XML leaves in a name, hands the parts over pre-split so a double surname survives, and drops an
 * unparseable ORCID. Returns null for a nameless or rejected entry, so one bad person never aborts the import.
 */
export function readPerson(
  text: { given?: string | null; surname?: string | null; suffix?: string | null; orcid?: string | null },
  overrides: Partial<Pick<Person, "contributions" | "contributorType" | "equalContribution" | "corresponding">>,
): Person | null {
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
