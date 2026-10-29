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
 * CodeMeta `Role` objects for every person with an ORCID iD: one per CRediT
 * role with a score above zero, `roleName` the role's credit.niso.org URL.
 * `skipped` lists the people who have roles but no ORCID iD to link them to.
 */
export function toCodemetaRoles(authors: Author[]): { roles: CodemetaRole[]; skipped: Author[] } {
  const roles: CodemetaRole[] = [];
  const skipped: Author[] = [];
  for (const author of authors) {
    const active = activeContributions(author);
    if (active.length === 0) continue;
    if (!author.orcid) {
      skipped.push(author);
      continue;
    }
    const orcidUrl = `https://orcid.org/${normalizeOrcid(author.orcid)}`;
    for (const contrib of active) {
      roles.push({ type: "Role", "schema:author": orcidUrl, roleName: getRoleByName(contrib.role).url });
    }
  }
  return { roles, skipped };
}
