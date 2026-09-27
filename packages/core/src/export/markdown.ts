import type { Author } from "../author";
import { activeContributions } from "../author";
import { DEFAULT_ROLE_TRANSLATOR, type RoleTranslator } from "../credit-i18n/index";
import { DEFAULT_UI_TRANSLATOR, type UiTranslator } from "../credit-i18n/ui-strings";
import { withLevel } from "../generate-statement";
import { markerNotes } from "../markers";
import { GENERATOR_NOTE } from "./generator-note";

/** Render untrusted text literally inside a Markdown table cell. */
function escapeCell(s: string): string {
  return s
    .replace(/\r?\n|\r/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/([|[\]`*_!])/g, "\\$1");
}

/**
 * Render the contributions as a Markdown table (Contributor → CRediT roles),
 * suitable for pasting into a README, GitHub issue, or manuscript draft.
 *
 * Lead-level roles are listed plainly; equal/supporting roles are annotated
 * with their level, matching the statement's `showLevels` behaviour.
 */
export function toMarkdown(
  authors: Author[],
  translateRole: RoleTranslator = DEFAULT_ROLE_TRANSLATOR,
  translateUi: UiTranslator = DEFAULT_UI_TRANSLATOR,
  locale = "en",
): string {
  const header = "| Contributor | CRediT roles |\n| --- | --- |";

  const rows = authors.map((author) => {
    const active = activeContributions(author);
    const roles =
      active.length === 0 ? "—" : active.map((c) => withLevel(translateRole(c.role), c.score, translateUi)).join(", ");
    return `| ${escapeCell(author.name)} | ${escapeCell(roles)} |`;
  });

  // Notes sit under the table as plain sentences, the way a journal prints them.
  const notes = markerNotes(authors, { translateUi, locale }).map((note) => escapeCell(note));

  // An HTML comment: invisible in every Markdown renderer, readable in the source.
  return [header, ...rows, ...(notes.length > 0 ? ["", ...notes] : []), "", `<!-- ${GENERATOR_NOTE} -->`].join("\n");
}
