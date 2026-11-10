import type { Author } from "./author";
import { activeContributions, scoreToLevel } from "./author";
import { DEFAULT_ROLE_TRANSLATOR, type RoleTranslator } from "./credit-i18n/index";
import { DEFAULT_UI_TRANSLATOR, fillTemplate, type UiTranslator } from "./credit-i18n/ui-strings";
import { CREDIT_ROLES, type CreditRoleName } from "./credit-roles";
import { contributorLabel, markerNotes } from "./markers";

export const STATEMENT_FORMATS = ["by-role", "by-role-short", "by-author", "by-author-short"] as const;

export type StatementFormat = (typeof STATEMENT_FORMATS)[number];

export interface StatementOptions {
  format: StatementFormat;
  /**
   * When true, append the contribution level (Equal / Supporting) after each
   * role name (by-author formats) or contributor label (by-role formats)
   * whose score is not 0 or 100. Lead contributions stay unannotated.
   */
  showLevels?: boolean;
  /**
   * Localize displayed role names (e.g. for a non-English statement). Defaults
   * to identity. The "CRediT:" prefix stays English.
   */
  translateRole?: RoleTranslator;
  /**
   * Localize the "Acknowledgements:" prefix and the Equal/Supporting level
   * labels. Defaults to English.
   */
  translateUi?: UiTranslator;
  /**
   * BCP-47 locale of the output language; drives the CLDR name-list wording
   * in the marker notes. Defaults to "en".
   */
  locale?: string;
  /**
   * When true (default), people marked as non-author contributors are credited
   * on a separate `Acknowledgements:` line. When false, everyone is listed
   * together on the single `CRediT:` line.
   */
  separateAcknowledgements?: boolean;
  /**
   * Emit HTML rather than plain text: each line becomes a `<p>`, and the
   * `CRediT:` prefix plus each leading label (the role in a by-role statement,
   * the contributor in a by-author one) is wrapped in `<strong>`.
   *
   * Both forms carry identical wording, because they travel together on the
   * clipboard and the recipient's editor picks one.
   */
  asHtml?: boolean;
}

/**
 * One run of statement text. `cell` marks the phrase that stands for one
 * contributor's role: the role in a by-author statement, the name in a by-role
 * one. `strong` marks the prefix and each leading label, bold in the HTML form.
 */
interface Part {
  text: string;
  strong?: boolean;
  cell?: StatementCell;
}

/** The contributor and role a statement phrase stands for. */
export interface StatementCell {
  authorId: string;
  role: CreditRoleName;
}

/**
 * A run of statement text, with the contributor and role it stands for when it
 * is one. Joined in order, the spans' text is exactly `generateStatement`'s
 * plain-text output.
 */
export interface StatementSpan {
  text: string;
  cell?: StatementCell;
}

/**
 * Escape element text. Deliberately not `escapeXml`: that turns an apostrophe
 * into `&apos;`, which some word processors render literally, and apostrophes
 * are common in author names.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Blank line between the CRediT, Acknowledgements and note lines in plain text. */
const LINE_BREAK = "\n\n";

/**
 * Generate a CRediT author statement.
 *
 * Named authors are listed after a `CRediT:` prefix; people marked as non-author
 * contributors are credited on a second `Acknowledgements:` line. CRediT applies
 * to both (see NISO guidance). Either line is omitted when no one on that side has
 * contributions; the two lines are separated by a blank line.
 *
 * Four formats, matching the original Python app:
 *
 * `by-role`:
 *   "CRediT: Conceptualization: Jane A. Smith, Bob White; Data curation: Jane A. Smith; ..."
 *
 * `by-role-short`:
 *   "CRediT: Conceptualization: JAS, BW; Data curation: JAS; ..."
 *
 * `by-author`:
 *   "CRediT: Jane A Smith: Conceptualization, Data curation; Bob White: Investigation; ..."
 *
 * `by-author-short`:
 *   "CRediT: JAS: Conceptualization, Data curation; BW: Investigation; ..."
 */
export function generateStatement(authors: Author[], options: StatementOptions): string {
  const lines = statementLines(authors, options);
  if (!options.asHtml) return lines.map(joinText).join(LINE_BREAK);
  const html = (part: Part) => (part.strong ? `<strong>${escapeHtml(part.text)}</strong>` : escapeHtml(part.text));
  return lines.map((line) => `<p>${line.map(html).join("")}</p>`).join("");
}

/**
 * The plain-text statement as spans, so a viewer can tie each phrase back to
 * the contributor and role it stands for. Takes the same options as
 * `generateStatement` (`asHtml` is ignored), and the spans' text joined in
 * order is exactly its plain-text output; no spans when that is empty.
 */
export function statementSpans(authors: Author[], options: StatementOptions): StatementSpan[] {
  const spans: StatementSpan[] = [];
  statementLines(authors, options).forEach((line, index) => {
    if (index > 0) spans.push({ text: LINE_BREAK });
    for (const { text, cell } of line) spans.push(cell ? { text, cell } : { text });
  });
  return spans;
}

const joinText = (parts: Part[]) => parts.map((part) => part.text).join("");

/** The statement's lines (CRediT, Acknowledgements, then the notes); none when nobody contributed. */
function statementLines(authors: Author[], options: StatementOptions): Part[][] {
  const {
    format,
    showLevels = false,
    translateRole = DEFAULT_ROLE_TRANSLATOR,
    translateUi = DEFAULT_UI_TRANSLATOR,
    locale = "en",
    separateAcknowledgements = true,
  } = options;
  const useInitials = format === "by-author-short" || format === "by-role-short";
  const byRole = format === "by-role" || format === "by-role-short";

  const body = (people: Author[]): Part[] =>
    byRole
      ? generateByRole(people, useInitials, showLevels, translateRole, translateUi)
      : generateByAuthor(people, useInitials, showLevels, translateRole, translateUi);
  const line = (prefix: string, parts: Part[]): Part[] => [{ text: prefix, strong: true }, { text: " " }, ...parts];

  // Combined: everyone (authors and non-authors) on one CRediT line.
  // The marker notes are appended to whichever lines the statement produces,
  // and suppressed entirely when there is no statement to annotate.
  const notes = markerNotes(authors, { useInitials, translateUi, locale }).map((text) => [{ text }]);

  if (!separateAcknowledgements) {
    const allBody = body(authors);
    return allBody.length > 0 ? [line("CRediT:", allBody), ...notes] : [];
  }

  // Split: named authors on the CRediT line, non-authors on Acknowledgements.
  const namedAuthors = authors.filter((a) => a.contributorType !== "non-author");
  const nonAuthors = authors.filter((a) => a.contributorType === "non-author");

  const lines: Part[][] = [];
  const creditBody = body(namedAuthors);
  if (creditBody.length > 0) lines.push(line("CRediT:", creditBody));
  const ackBody = body(nonAuthors);
  if (ackBody.length > 0)
    lines.push(line(`${translateUi("acknowledgements")}${translateUi("labelSeparator").trimEnd()}`, ackBody));
  if (lines.length === 0) return [];
  return [...lines, ...notes];
}

/** Annotate a role or contributor label with its non-lead level: "label (Equal)". */
export function withLevel(label: string, score: number, translateUi: UiTranslator): string {
  const level = scoreToLevel(score);
  if (level === "lead") return label;
  const levelLabel = level === "equal" ? translateUi("equal") : translateUi("supporting");
  return fillTemplate(translateUi("levelAnnotation"), { label, level: levelLabel });
}

/** `items` with `separator` runs between them. */
function interleave(items: Part[][], separator: string): Part[] {
  return items.flatMap((item, index) => (index === 0 ? item : [{ text: separator }, ...item]));
}

/** Body of a by-role statement (no `CRediT:`/`Acknowledgements:` prefix); empty if nobody contributed. */
function generateByRole(
  authors: Author[],
  useInitials: boolean,
  showLevels: boolean,
  translateRole: RoleTranslator,
  translateUi: UiTranslator,
): Part[] {
  // Collect contributor labels per role, in author order. Keyed on the
  // canonical English role; localized only when emitting the line.
  const roleMap = new Map<string, Part[][]>();

  for (const author of authors) {
    const label = contributorLabel(author, useInitials);
    for (const contrib of activeContributions(author)) {
      const list = roleMap.get(contrib.role) ?? [];
      list.push([
        {
          text: showLevels ? withLevel(label, contrib.score, translateUi) : label,
          cell: { authorId: author.id, role: contrib.role },
        },
      ]);
      roleMap.set(contrib.role, list);
    }
  }

  // Emit in canonical CRediT order, not first-author-encounter order, so the
  // statement matches the documented role sequence regardless of who contributed.
  // The list and segment separators are catalog-owned: the marker notes
  // already join with them, and a ja/zh statement must not mix ASCII "," and
  // ";" into otherwise full-width punctuation.
  const segments = CREDIT_ROLES.filter((r) => roleMap.has(r.name)).map((r) => [
    { text: translateRole(r.name), strong: true },
    { text: translateUi("labelSeparator") },
    ...interleave(roleMap.get(r.name) ?? [], translateUi("nameListSeparator")),
  ]);

  return interleave(segments, translateUi("segmentSeparator"));
}

/** Body of a by-author statement (no `CRediT:`/`Acknowledgements:` prefix); empty if nobody contributed. */
function generateByAuthor(
  authors: Author[],
  useInitials: boolean,
  showLevels: boolean,
  translateRole: RoleTranslator,
  translateUi: UiTranslator,
): Part[] {
  const segments: Part[][] = [];

  for (const author of authors) {
    const active = activeContributions(author);
    if (active.length === 0) continue;

    const roles = active.map((c) => [
      {
        text: showLevels ? withLevel(translateRole(c.role), c.score, translateUi) : translateRole(c.role),
        cell: { authorId: author.id, role: c.role },
      },
    ]);

    segments.push([
      { text: contributorLabel(author, useInitials), strong: true },
      { text: translateUi("labelSeparator") },
      ...interleave(roles, translateUi("nameListSeparator")),
    ]);
  }

  return interleave(segments, translateUi("segmentSeparator"));
}
