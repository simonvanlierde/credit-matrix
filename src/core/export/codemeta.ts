import type { Contributor } from "../author";
import { activeContributions, isGroup, normalizeOrcid, orcidOf } from "../author";
import { getRoleByName } from "../credit-roles";
import { givenNamesOf, suffixOf } from "./xml";

export interface CodemetaPerson {
  /** A group is an `Organization`. */
  type: "Person" | "Organization";
  id: string;
  name: string;
  /** A group's alias. */
  alternateName?: string;
  givenName?: string;
  familyName?: string;
}

/** A CodeMeta 3.0 Role linked to a Person in the same attribution fragment. */
export interface CodemetaRole {
  type: "Role";
  "schema:author": string;
  roleName: string;
}

export interface CodemetaAttribution {
  "@context": "https://w3id.org/codemeta/3.0";
  author: (CodemetaPerson | CodemetaRole)[];
  contributor: (CodemetaPerson | CodemetaRole)[];
}

/**
 * Export people with active contributions and their linked CRediT roles.
 * A group is an `Organization` with its alias as `alternateName` and its ROR URL as `id`.
 * Non-authors go in contributor. Without an ORCID, a roster-position fragment
 * links the person only within this document; it is not a persistent identity.
 * Merge the returned fields into the work's CodeMeta record. Keep native JSON
 * for scores, contribution levels, equal contribution and correspondence.
 */
export function toCodemeta(authors: Contributor[]): { metadata: CodemetaAttribution; warnings: string[] } {
  const { metadata, warnings } = buildAttribution(authors);
  if (metadata.author.length || metadata.contributor.length) {
    warnings.push("CodeMeta omits scores and contribution levels; keep the original roster JSON.");
  }
  return { metadata: { "@context": "https://w3id.org/codemeta/3.0", ...metadata }, warnings };
}

/** Shared people and Role construction for the two linked-data exports. */
export function buildAttribution(authors: Contributor[]) {
  const metadata: Pick<CodemetaAttribution, "author" | "contributor"> = {
    author: [],
    contributor: [],
  };
  const warnings: string[] = [];
  for (const [index, author] of authors.entries()) {
    const active = activeContributions(author);
    if (active.length === 0) continue;
    const orcid = orcidOf(author);
    const ror = isGroup(author) ? author.ror : undefined;
    const persistent = orcid
      ? `https://orcid.org/${normalizeOrcid(orcid)}`
      : ror
        ? `https://ror.org/${ror}`
        : undefined;
    const id = persistent ?? `#credit-matrix-person-${index + 1}`;
    if (!persistent) {
      warnings.push(
        isGroup(author)
          ? `${author.name} has no ROR id; its link identifies it only within this document.`
          : `${author.name} has no ORCID iD; their link identifies them only within this document.`,
      );
    }
    const entries = author.contributorType === "non-author" ? metadata.contributor : metadata.author;
    entries.push({
      type: isGroup(author) ? "Organization" : "Person",
      id,
      name: author.name.normalize("NFC"),
      ...(isGroup(author) && author.alias ? { alternateName: author.alias.normalize("NFC") } : {}),
      ...(!isGroup(author) && author.surname
        ? {
            givenName: givenNamesOf(author).normalize("NFC"),
            familyName: [author.surname, suffixOf(author)].filter(Boolean).join(" ").normalize("NFC"),
          }
        : {}),
    });
    for (const contribution of active) {
      entries.push({ type: "Role", "schema:author": id, roleName: getRoleByName(contribution.role).url });
    }
  }
  return { metadata, warnings };
}
