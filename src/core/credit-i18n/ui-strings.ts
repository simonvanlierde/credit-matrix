import { setupI18n } from "@lingui/core";
import { loadCatalog } from "./catalogs";
import { hasCatalog } from "./index";
import { messages } from "./locales/en/messages";
/** Non-role strings in statements and human-facing exports, from Lingui PO catalogs. */

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
  | "labelSeparator"
  | "nameListSeparator"
  | "segmentSeparator"
  | "levelAnnotation";

export type UiTranslator = (key: UiKey) => string;

/**
 * Fill `{name}` placeholders in a catalog template, in one pass so a value
 * that itself contains "{level}" (a contributor's name) is left as written.
 * A replacer function, not a replacement string: a value containing "$&" or
 * "$'" would otherwise be expanded as a replacement pattern.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(vars, key) ? (vars[key] ?? "") : match));
}

/** A complete output catalog. Missing prose must fail before release. */
export type UiCatalog = Record<UiKey, string>;

/** Canonical English: the source text and the fallback for any missing entry. */
const english = setupI18n({ locale: "en", messages: { en: messages } });
const EN_UI = Object.fromEntries(
  Object.keys(messages)
    .filter((key) => key.startsWith("output."))
    .map((key) => [key.slice(7), english._(key, { names: "{names}", label: "{label}", level: "{level}" })]),
) as UiCatalog;

/** Load a locale's UI catalog. Returns null for `en` or any unknown locale (→ English). */
export async function loadUiCatalog(locale: string): Promise<UiCatalog | null> {
  if (!hasCatalog(locale)) return null;
  const i18n = await loadCatalog(locale);
  return Object.fromEntries(
    Object.keys(EN_UI).map((key) => [
      key,
      i18n._(`output.${key}`, { names: "{names}", label: "{label}", level: "{level}" }),
    ]),
  ) as UiCatalog;
}

/**
 * Build a UI-string translator from a catalog. A missing catalog uses English.
 */
export function makeUiTranslator(catalog: Partial<UiCatalog> | null | undefined): UiTranslator {
  if (!catalog) return (key) => EN_UI[key];
  // Test blankness on the trimmed value but keep the original: separators
  // (", ", "; ") hold meaningful whitespace.
  return (key) => {
    const value = catalog[key];
    return value?.trim() ? value : EN_UI[key];
  };
}

/** Canonical English UI translator (no catalog): the default for all consumers. */
export const DEFAULT_UI_TRANSLATOR: UiTranslator = makeUiTranslator(null);
