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
   * Both forms have identical wording, because they travel together on the
   * clipboard and the recipient's editor picks one.
   */
  asHtml?: boolean;
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
  /** Set on a contributor's name, where it is not itself a role phrase (by-author statements). */
  authorId?: string;
}

/** Render strings directly; allocate contributor metadata only for interactive spans. */
interface Formatter<T extends string | StatementSpan[]> {
  text: (value: string) => T;
  strong: (value: string) => T;
  cell: (value: string, authorId: string, role: CreditRoleName) => T;
  name: (value: string, authorId: string) => T;
  join: (items: T[], separator: string) => T;
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

const TEXT_FORMATTER: Formatter<string> = {
  text: (value) => value,
  strong: (value) => value,
  cell: (value) => value,
  name: (value) => value,
  join: (items, separator) => items.join(separator),
};

const HTML_FORMATTER: Formatter<string> = {
  text: escapeHtml,
  strong: (value) => `<strong>${escapeHtml(value)}</strong>`,
  cell: escapeHtml,
  name: (value) => `<strong>${escapeHtml(value)}</strong>`,
  join: (items, separator) => items.join(escapeHtml(separator)),
};

const SPAN_FORMATTER: Formatter<StatementSpan[]> = {
  text: (text) => [{ text }],
  strong: (text) => [{ text }],
  cell: (text, authorId, role) => [{ text, cell: { authorId, role } }],
  name: (text, authorId) => [{ text, authorId }],
  join: (items, separator) => {
    const spans: StatementSpan[] = [];
    for (const item of items) {
      if (separator && spans.length > 0) spans.push({ text: separator });
      spans.push(...item);
    }
    return spans;
  },
};

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
  if (!options.asHtml) return statementLines(authors, options, TEXT_FORMATTER).join(LINE_BREAK);
  return statementLines(authors, options, HTML_FORMATTER)
    .map((line) => `<p>${line}</p>`)
    .join("");
}

/**
 * The plain-text statement as spans, so a viewer can tie each phrase back to
 * the contributor and role it stands for. Takes the same options as
 * `generateStatement` (`asHtml` is ignored), and the spans' text joined in
 * order is exactly its plain-text output; no spans when that is empty.
 */
export function statementSpans(authors: Author[], options: StatementOptions): StatementSpan[] {
  return SPAN_FORMATTER.join(statementLines(authors, options, SPAN_FORMATTER), LINE_BREAK);
}

/** The statement's lines (CRediT, Acknowledgements, then the notes); none when nobody contributed. */
function statementLines<T extends string | StatementSpan[]>(
  authors: Author[],
  options: StatementOptions,
  fmt: Formatter<T>,
): T[] {
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

  const body = (people: Author[]): T =>
    byRole
      ? generateByRole(people, useInitials, showLevels, translateRole, translateUi, fmt)
      : generateByAuthor(people, useInitials, showLevels, translateRole, translateUi, fmt);
  const line = (prefix: string, content: T): T => fmt.join([fmt.strong(prefix), fmt.text(" "), content], "");

  // Combined: everyone (authors and non-authors) on one CRediT line.
  // The marker notes are appended to whichever lines the statement produces,
  // and suppressed entirely when there is no statement to annotate.
  const notes = markerNotes(authors, { useInitials, translateUi, locale }).map(fmt.text);

  if (!separateAcknowledgements) {
    const allBody = body(authors);
    return allBody.length > 0 ? [line("CRediT:", allBody), ...notes] : [];
  }

  // Split: named authors on the CRediT line, non-authors on Acknowledgements.
  const namedAuthors = authors.filter((a) => a.contributorType !== "non-author");
  const nonAuthors = authors.filter((a) => a.contributorType === "non-author");

  const lines: T[] = [];
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

/** Body of a by-role statement (no `CRediT:`/`Acknowledgements:` prefix); empty if nobody contributed. */
function generateByRole<T extends string | StatementSpan[]>(
  authors: Author[],
  useInitials: boolean,
  showLevels: boolean,
  translateRole: RoleTranslator,
  translateUi: UiTranslator,
  fmt: Formatter<T>,
): T {
  // Collect contributor labels per role, in author order. Keyed on the
  // canonical English role; localized only when emitting the line.
  const roleMap = new Map<string, T[]>();

  for (const author of authors) {
    const label = contributorLabel(author, useInitials);
    for (const contrib of activeContributions(author)) {
      const list = roleMap.get(contrib.role) ?? [];
      list.push(fmt.cell(showLevels ? withLevel(label, contrib.score, translateUi) : label, author.id, contrib.role));
      roleMap.set(contrib.role, list);
    }
  }

  // Emit in canonical CRediT order, not first-author-encounter order, so the
  // statement matches the documented role sequence regardless of who contributed.
  // The list and segment separators are catalog-owned: the marker notes
  // already join with them, and a ja/zh statement must not mix ASCII "," and
  // ";" into otherwise full-width punctuation.
  const segments = CREDIT_ROLES.filter((r) => roleMap.has(r.name)).map((r) =>
    fmt.join(
      [
        fmt.strong(translateRole(r.name)),
        fmt.text(translateUi("labelSeparator")),
        fmt.join(roleMap.get(r.name) ?? [], translateUi("nameListSeparator")),
      ],
      "",
    ),
  );

  return fmt.join(segments, translateUi("segmentSeparator"));
}

/** Body of a by-author statement (no `CRediT:`/`Acknowledgements:` prefix); empty if nobody contributed. */
function generateByAuthor<T extends string | StatementSpan[]>(
  authors: Author[],
  useInitials: boolean,
  showLevels: boolean,
  translateRole: RoleTranslator,
  translateUi: UiTranslator,
  fmt: Formatter<T>,
): T {
  const segments: T[] = [];

  for (const author of authors) {
    const active = activeContributions(author);
    if (active.length === 0) continue;

    const roles = active.map((c) =>
      fmt.cell(
        showLevels ? withLevel(translateRole(c.role), c.score, translateUi) : translateRole(c.role),
        author.id,
        c.role,
      ),
    );

    segments.push(
      fmt.join(
        [
          fmt.name(contributorLabel(author, useInitials), author.id),
          fmt.text(translateUi("labelSeparator")),
          fmt.join(roles, translateUi("nameListSeparator")),
        ],
        "",
      ),
    );
  }

  return fmt.join(segments, translateUi("segmentSeparator"));
}
