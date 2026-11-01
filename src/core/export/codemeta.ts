import type { Author } from "../author";
import { activeContributions, normalizeOrcid } from "../author";
import { getRoleByName } from "../credit-roles";
import { givenNamesOf, suffixOf } from "./xml";

export interface CodemetaPerson {
  type: "Person";
  id: string;
  name: string;
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
 * Non-authors go in contributor. Without an ORCID, a roster-position fragment
 * links the person only within this document; it is not a persistent identity.
 * Merge the returned fields into the work's CodeMeta record. Keep native JSON
 * for scores, contribution levels, equal contribution and correspondence.
 */
export function toCodemeta(authors: Author[]): { metadata: CodemetaAttribution; warnings: string[] } {
  const metadata: CodemetaAttribution = {
    "@context": "https://w3id.org/codemeta/3.0",
    author: [],
    contributor: [],
  };
  const warnings: string[] = [];
  for (const [index, author] of authors.entries()) {
    const active = activeContributions(author);
    if (active.length === 0) continue;
    const id = author.orcid
      ? `https://orcid.org/${normalizeOrcid(author.orcid)}`
      : `#credit-matrix-person-${index + 1}`;
    if (!author.orcid) {
      warnings.push(`${author.name} has no ORCID iD; their link identifies them only within this document.`);
    }
    const entries = author.contributorType === "non-author" ? metadata.contributor : metadata.author;
    entries.push({
      type: "Person",
      id,
      name: author.name.normalize("NFC"),
      ...(author.surname
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
  if (metadata.author.length || metadata.contributor.length) {
    warnings.push("CodeMeta omits scores and contribution levels; keep the original roster JSON.");
  }
  return { metadata, warnings };
}
