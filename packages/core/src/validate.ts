import type { Author } from "./author";
import { hasContributions, rolesWithContributions } from "./author";
import type { CreditRoleName } from "./credit-roles";

export type ValidationIssue =
  // authorId keys the rendered list: two contributors can share a name.
  // `message` is the English fallback for non-UI consumers of the core
  // package; the app renders its own localized text from `code`.
  | { level: "warning"; code: "authorNoRoles"; authorId: string; authorName: string; message: string }
  | { level: "info"; code: "roleUnassigned"; role: CreditRoleName; message: string };

/** Roles most journals expect to be assigned to at least one contributor. */
const EXPECTED_ROLES: CreditRoleName[] = ["Conceptualization", "Writing – original draft"];

/**
 * Check a set of authors for common CRediT statement problems, mirroring the
 * sanity checks an editor or submission system would run.
 *
 * Pure and side-effect free. Returns an ordered list of issues (empty when the
 * statement looks complete). Returns nothing for an empty author list, since
 * "no authors yet" is a starting state rather than a mistake.
 */
export function validateContributions(authors: Author[]): ValidationIssue[] {
  if (authors.length === 0) return [];

  const issues: ValidationIssue[] = [];

  for (const author of authors) {
    if (!hasContributions(author)) {
      issues.push({
        level: "warning",
        code: "authorNoRoles",
        authorId: author.id,
        authorName: author.name || "An author",
        message: `${author.name || "An author"} has no assigned CRediT roles.`,
      });
    }
  }

  const assigned = new Set(rolesWithContributions(authors));

  for (const role of EXPECTED_ROLES) {
    if (!assigned.has(role)) {
      issues.push({
        level: "info",
        code: "roleUnassigned",
        role,
        message: `No contributor is assigned “${role}”.`,
      });
    }
  }

  return issues;
}
