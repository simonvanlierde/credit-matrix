import type { Author } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { GENERATOR_NOTE } from "./generator-note";

// credits.sty re-expands names with \xdef on every \credit, so these five go through \protected macros.
const PROTECTED_SPECIALS: Record<string, string> = {
  _: "\\crUS{}",
  $: "\\crDOLLAR{}",
  "~": "\\crTILDE{}",
  "^": "\\crCARET{}",
  "\\": "\\crBSLASH{}",
};
const PROTECTED_MACROS = [
  // biome-ignore lint/security/noSecrets: a LaTeX macro definition, not a credential.
  "\\protected\\def\\crUS{\\_}\\protected\\def\\crDOLLAR{\\$}",
  // biome-ignore lint/security/noSecrets: a LaTeX macro definition, not a credential.
  "\\protected\\def\\crTILDE{\\textasciitilde}\\protected\\def\\crCARET{\\textasciicircum}",
  // biome-ignore lint/security/noSecrets: a LaTeX macro definition, not a credential.
  "\\protected\\def\\crBSLASH{\\textbackslash}",
];

/** Make untrusted text print literally in a credits.sty name. Line breaks become spaces. */
function escapeLatex(s: string): string {
  return s.replace(/\s*[\r\n]+\s*/g, " ").replace(/[\\&%$#_{}~^]/g, (c) => PROTECTED_SPECIALS[c] ?? `\\${c}`);
}

/**
 * A draft as input for the latex-credits package (github.com/Pseudomanifold/latex-credits).
 * Each author becomes one granular `\credit` line: 14 values in CRediT order, each the
 * role's 0-100 score divided by 100, so lead, equal and supporting show as different
 * shades in `\insertcreditsgranular`. The package's plain role list has no levels.
 * Only authors are listed: the package has no place for acknowledgees.
 * With `yesNo` (the Yes/No input mode) every role is 1 or 0.
 * With no author roles there is no `\credit` line, only a comment: credits.sty fails on none.
 */
export function toLatexCredits(authors: Author[], { yesNo = false }: { yesNo?: boolean } = {}): string {
  const listed = authors.filter((author) => author.contributorType === "author");
  const hasRoles = listed.some((author) => author.contributions.some((c) => c.score > 0));
  const lines = hasRoles
    ? listed.map((author) => {
        const values = CREDIT_ROLES.map((role) => {
          const score = author.contributions.find((c) => c.role === role.name)?.score ?? 0;
          return String(yesNo ? (score > 0 ? 1 : 0) : score / 100);
        });
        return `\\credit{${escapeLatex(author.name)}}{${values.join(",")}}`;
      })
    : ["% No authors with roles yet"];
  const needsMacros = hasRoles && listed.some((author) => /[_$~^\\]/.test(author.name));
  return [
    "% CRediT contributions for the latex-credits package",
    "% (https://github.com/Pseudomanifold/latex-credits). Put credits.sty next to your .tex file, then:",
    "%   \\usepackage{credits}           % in the preamble; the option skipempty hides unused roles",
    "%   \\insertcreditsgranular        % in the text: the role table, shaded by level",
    "%   \\insertcreditsgranularstatement  % or: the statement as sentences",
    "% Values run 0 to 1 in CRediT order. Lead is 1, equal 0.66, supporting 0.33.",
    "% Acknowledgees are left out: the package lists authors only.",
    "% Names outside Latin scripts need lualatex or xelatex with a suitable font.",
    `% ${GENERATOR_NOTE}`,
    ...(needsMacros ? PROTECTED_MACROS : []),
    ...lines,
  ].join("\n");
}
