import type { Author } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { GENERATOR_NOTE } from "./generator-note";

const LATEX_SPECIALS: Record<string, string> = {
  // biome-ignore lint/security/noSecrets: a LaTeX command, not a credential.
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

/** Make untrusted text print literally in LaTeX. Line breaks become spaces. */
function escapeLatex(s: string): string {
  return s.replace(/\s*[\r\n]+\s*/g, " ").replace(/[\\&%$#_{}~^]/g, (c) => LATEX_SPECIALS[c] ?? c);
}

/**
 * A draft as input for the latex-credits package (github.com/Pseudomanifold/latex-credits).
 * Each author becomes one granular `\credit` line: 14 values in CRediT order, each the
 * role's 0-100 score divided by 100, so lead, equal and supporting show as different
 * shades in `\insertcreditsgranular`. The package's plain role list has no levels.
 * Only authors are listed: the package has no place for acknowledgees.
 */
export function toLatexCredits(authors: Author[]): string {
  const lines = authors
    .filter((author) => author.contributorType === "author")
    .map((author) => {
      const values = CREDIT_ROLES.map((role) => {
        const score = author.contributions.find((c) => c.role === role.name)?.score ?? 0;
        return String(score / 100);
      });
      return `\\credit{${escapeLatex(author.name)}}{${values.join(",")}}`;
    });
  return [
    "% CRediT contributions for the latex-credits package",
    "% (https://github.com/Pseudomanifold/latex-credits). Put credits.sty next to your .tex file, then:",
    "%   \\usepackage{credits}           % in the preamble; the option skipempty hides unused roles",
    "%   \\insertcreditsgranular        % in the text: the role table, shaded by level",
    "%   \\insertcreditsgranularstatement  % or: the statement as sentences",
    "% Values run 0 to 1 in CRediT order. Lead is 1, equal 0.66, supporting 0.33.",
    "% Acknowledgees are left out: the package lists authors only.",
    `% ${GENERATOR_NOTE}`,
    ...lines,
  ].join("\n");
}
