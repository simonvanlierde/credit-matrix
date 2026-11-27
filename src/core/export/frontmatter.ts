import type { Contributor } from "../author";
import { activeContributions, isGroup, normalizeOrcid, orcidOf, scoreToLevel } from "../author";

/**
 * YAML for Quarto/Pandoc's `author` field, with canonical CRediT names and levels.
 * `yesNo` writes role names without degrees. Non-authors are omitted, never added to the byline.
 */
export function toQuarto(authors: Contributor[], { yesNo = false }: { yesNo?: boolean } = {}): string {
  return authorYaml(authors, "author", !yesNo);
}

/**
 * YAML for MyST's `authors` field. Paste under `project` in myst.yml or into page front matter.
 * MyST has no contribution levels. Non-authors are omitted, never added to the byline.
 */
export function toMyst(authors: Contributor[]): string {
  return authorYaml(authors, "authors", false);
}

function authorYaml(authors: Contributor[], key: "author" | "authors", levels: boolean): string {
  const listed = authors.filter((author) => author.contributorType === "author");
  const lines = [
    "# Keep native JSON for scores, author markers and replies.",
    "# Non-author contributors are left out; acknowledge them separately.",
    ...(key === "authors" ? ["# MyST omits contribution levels; all listed roles are ungraded."] : []),
    listed.length ? `${key}:` : `${key}: []`,
  ];
  for (const author of listed) {
    // JSON strings are YAML double-quoted scalars, including names with colons, quotes or newlines.
    lines.push(`  - name: ${JSON.stringify(author.name)}`);
    // A group has no ORCID iD. `kind` lets the statement plugins name it as a group, with its alias for initials.
    if (isGroup(author)) {
      lines.push("    kind: group");
      if (author.alias) lines.push(`    alias: ${JSON.stringify(author.alias)}`);
    }
    const orcid = orcidOf(author);
    if (orcid) lines.push(`    orcid: ${JSON.stringify(normalizeOrcid(orcid))}`);
    const roles = activeContributions(author);
    lines.push(roles.length ? "    roles:" : "    roles: []");
    for (const { role, score } of roles) {
      lines.push(`      - ${JSON.stringify(role)}${levels ? `: ${scoreToLevel(score)}` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
