/**
 * UI-string translations: the non-role strings in human-facing output
 * (statement + heatmap): "Acknowledgements", the contribution-level labels, the
 * heatmap's accessible name, and the empty-state line.
 *
 * Mirrors the role-catalog setup (one lazy-loaded JSON per locale, code-split by
 * the bundler) so the live UI and exports share one mechanism and this can grow
 * to cover the whole app. English is the canonical source and the per-key
 * fallback; per-locale catalogs in ./ui/ hold only the overrides. Our strings,
 * not the community role repo's, hence a separate directory.
 */

import { hasCatalog } from "./index";

export type UiKey =
  | "acknowledgements"
  | "lead"
  | "equal"
  | "supporting"
  | "none"
  | "contributed"
  | "emptyState"
  | "heatmapTitle"
  | "equalContributionNote"
  | "correspondenceNote"
  | "nameListSeparator"
  | "segmentSeparator"
  | "levelAnnotation";

export type UiTranslator = (key: UiKey) => string;

/**
 * Fill `{name}` placeholders in a catalog template. Replacer functions, not
 * replacement strings: a value containing "$&" or "$'" would otherwise be
 * expanded as a replacement pattern.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(`{${key}}`, () => value);
  }
  return result;
}

/** A complete output catalog. Missing prose must fail before release. */
export type UiCatalog = Record<UiKey, string>;

/** Canonical English: the source text and the fallback for any missing entry. */
const EN_UI: Record<UiKey, string> = {
  acknowledgements: "Acknowledgements",
  lead: "Lead",
  equal: "Equal",
  supporting: "Supporting",
  none: "None",
  contributed: "Contributed",
  emptyState: "No contributions assigned yet.",
  // Accessible name for the exported heatmap SVG; nothing draws it.
  heatmapTitle: "Contribution heatmap",
  // `{names}` is substituted with the marked contributors.
  equalContributionNote: "{names} contributed equally to this work.",
  correspondenceNote: "Correspondence: {names}.",
  nameListSeparator: ", ",
  // Joins the segments of a statement ("Role: names; Role: names"). Its own
  // key because CJK locales use full-width punctuation ("；"), and mixing
  // ASCII separators into a ja/zh statement reads as a typo.
  segmentSeparator: "; ",
  // How a non-lead level annotates its label; CJK locales use full-width
  // parentheses.
  levelAnnotation: "{label} ({level})",
};

/** Load a locale's UI catalog. Returns null for `en` or any unknown locale (→ English). */
export async function loadUiCatalog(locale: string): Promise<UiCatalog | null> {
  if (!hasCatalog(locale)) return null;
  const mod: { default: UiCatalog } = await import(`./ui/${locale}.json`);
  return mod.default;
}

/**
 * Build a UI-string translator from a catalog. A missing catalog uses English.
 */
export function makeUiTranslator(catalog: Partial<UiCatalog> | null | undefined): UiTranslator {
  if (!catalog) return (key) => EN_UI[key];
  // Test blankness on the trimmed value but keep the original: separators
  // (", ", " ; ") carry meaningful whitespace.
  return (key) => {
    const value = catalog[key];
    return value?.trim() ? value : EN_UI[key];
  };
}

/** Canonical English UI translator (no catalog): the default for all consumers. */
export const DEFAULT_UI_TRANSLATOR: UiTranslator = makeUiTranslator(null);
