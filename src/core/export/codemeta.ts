import type { Author } from "../author";
import { activeContributions, normalizeOrcid } from "../author";
import { getRoleByName } from "../credit-roles";

/** A CodeMeta 3.0 `Role`, linked to its person by ORCID URL as in the CodeMeta user guide. */
export interface CodemetaRole {
  type: "Role";
  "schema:author": string;
  roleName: string;
}

/**
 * CodeMeta `Role` objects for every author with an ORCID iD: one per CRediT
 * role with a score above zero, `roleName` the role's credit.niso.org URL.
 * `skipped` lists, in roster order, the people with roles who are left out:
 * non-authors, since the roles go in codemeta.json's `author` list, and
 * authors with no ORCID iD to link them to.
 */
export function toCodemetaRoles(authors: Author[]): {
  roles: CodemetaRole[];
  skipped: { author: Author; reason: "non-author" | "no-orcid" }[];
} {
  const roles: CodemetaRole[] = [];
  const skipped: { author: Author; reason: "non-author" | "no-orcid" }[] = [];
  for (const author of authors) {
    const active = activeContributions(author);
    if (active.length === 0) continue;
    if (author.contributorType === "non-author") {
      skipped.push({ author, reason: "non-author" });
      continue;
    }
    if (!author.orcid) {
      skipped.push({ author, reason: "no-orcid" });
      continue;
    }
    const orcidUrl = `https://orcid.org/${normalizeOrcid(author.orcid)}`;
    for (const contrib of active) {
      roles.push({ type: "Role", "schema:author": orcidUrl, roleName: getRoleByName(contrib.role).url });
    }
  }
  return { roles, skipped };
}
