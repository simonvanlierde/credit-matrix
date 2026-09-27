import type { Author } from "./author";
import { activeContributions, scoreToLevel } from "./author";
import { DEFAULT_ROLE_TRANSLATOR, type RoleTranslator } from "./credit-i18n/index";
import { DEFAULT_UI_TRANSLATOR, fillTemplate, type UiTranslator } from "./credit-i18n/ui-strings";
import { CREDIT_ROLES } from "./credit-roles";
import { contributorLabel, markerNotes } from "./markers";

export type StatementFormat = "by-role" | "by-role-short" | "by-author" | "by-author-short";

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
 * How one statement flavour renders its pieces. The text formatter is the
 * identity; the HTML one escapes and emphasizes.
 */
interface Formatter {
  /** Plain text that must survive as text. */
  text: (value: string) => string;
  /** The leading label of a segment, and the line prefix. */
  strong: (value: string) => string;
  /** Join the CRediT and Acknowledgements lines. */
  join: (lines: string[]) => string;
}

/**
 * Escape element text. Deliberately not `escapeXml`: that turns an apostrophe
 * into `&apos;`, which some word processors render literally, and apostrophes
 * are common in author names.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TEXT_FORMATTER: Formatter = {
  text: (value) => value,
  strong: (value) => value,
  join: (lines) => lines.join("\n\n"),
};

const HTML_FORMATTER: Formatter = {
  text: escapeHtml,
  strong: (value) => `<strong>${escapeHtml(value)}</strong>`,
  join: (lines) => lines.map((line) => `<p>${line}</p>`).join(""),
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
  const {
    format,
    showLevels = false,
    translateRole = DEFAULT_ROLE_TRANSLATOR,
    translateUi = DEFAULT_UI_TRANSLATOR,
    locale = "en",
    separateAcknowledgements = true,
    asHtml = false,
  } = options;
  const fmt = asHtml ? HTML_FORMATTER : TEXT_FORMATTER;
  const useInitials = format === "by-author-short" || format === "by-role-short";
  const byRole = format === "by-role" || format === "by-role-short";

  const body = (people: Author[]): string =>
    byRole
      ? generateByRole(people, useInitials, showLevels, translateRole, translateUi, fmt)
      : generateByAuthor(people, useInitials, showLevels, translateRole, translateUi, fmt);

  // Combined: everyone (authors and non-authors) on one CRediT line.
  // The marker notes are appended to whichever lines the statement produces,
  // and suppressed entirely when there is no statement to annotate.
  const notes = markerNotes(authors, { useInitials, translateUi, locale }).map(fmt.text);

  if (!separateAcknowledgements) {
    const allBody = body(authors);
    return allBody ? fmt.join([`${fmt.strong("CRediT:")} ${allBody}`, ...notes]) : "";
  }

  // Split: named authors on the CRediT line, non-authors on Acknowledgements.
  const namedAuthors = authors.filter((a) => a.contributorType !== "non-author");
  const nonAuthors = authors.filter((a) => a.contributorType === "non-author");

  const lines: string[] = [];
  const creditBody = body(namedAuthors);
  if (creditBody) lines.push(`${fmt.strong("CRediT:")} ${creditBody}`);
  const ackBody = body(nonAuthors);
  if (ackBody) lines.push(`${fmt.strong(`${translateUi("acknowledgements")}:`)} ${ackBody}`);
  if (lines.length === 0) return "";
  return fmt.join([...lines, ...notes]);
}

/** Annotate a role or contributor label with its non-lead level: "label (Equal)". */
export function withLevel(label: string, score: number, translateUi: UiTranslator): string {
  const level = scoreToLevel(score);
  if (level === "lead") return label;
  const levelLabel = level === "equal" ? translateUi("equal") : translateUi("supporting");
  return fillTemplate(translateUi("levelAnnotation"), { label, level: levelLabel });
}

/** Body of a by-role statement (no `CRediT:`/`Acknowledgements:` prefix); "" if empty. */
function generateByRole(
  authors: Author[],
  useInitials: boolean,
  showLevels: boolean,
  translateRole: RoleTranslator,
  translateUi: UiTranslator,
  fmt: Formatter,
): string {
  // Collect contributor labels per role, in author order. Keyed on the
  // canonical English role; localized only when emitting the line.
  const roleMap = new Map<string, string[]>();

  for (const author of authors) {
    const label = contributorLabel(author, useInitials);
    for (const contrib of activeContributions(author)) {
      const list = roleMap.get(contrib.role) ?? [];
      list.push(fmt.text(showLevels ? withLevel(label, contrib.score, translateUi) : label));
      roleMap.set(contrib.role, list);
    }
  }

  if (roleMap.size === 0) return "";

  // Emit in canonical CRediT order, not first-author-encounter order, so the
  // statement matches the documented role sequence regardless of who contributed.
  // The list and segment separators are catalog-owned: the marker notes
  // already join with them, and a ja/zh statement must not mix ASCII "," and
  // ";" into otherwise full-width punctuation.
  const parts = CREDIT_ROLES.filter((r) => roleMap.has(r.name)).map(
    (r) =>
      `${fmt.strong(translateRole(r.name))}: ${(roleMap.get(r.name) ?? []).join(translateUi("nameListSeparator"))}`,
  );

  return parts.join(translateUi("segmentSeparator"));
}

/** Body of a by-author statement (no `CRediT:`/`Acknowledgements:` prefix); "" if empty. */
function generateByAuthor(
  authors: Author[],
  useInitials: boolean,
  showLevels: boolean,
  translateRole: RoleTranslator,
  translateUi: UiTranslator,
  fmt: Formatter,
): string {
  const parts: string[] = [];

  for (const author of authors) {
    const active = activeContributions(author);
    if (active.length === 0) continue;

    const label = contributorLabel(author, useInitials);

    const roleList = active.map((c) =>
      showLevels ? withLevel(translateRole(c.role), c.score, translateUi) : translateRole(c.role),
    );

    parts.push(`${fmt.strong(label)}: ${roleList.map(fmt.text).join(translateUi("nameListSeparator"))}`);
  }

  if (parts.length === 0) return "";
  return parts.join(translateUi("segmentSeparator"));
}
