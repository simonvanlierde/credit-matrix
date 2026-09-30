import { getRoleByName } from "../credit-roles";

/**
 * Localized CRediT role names/descriptions, sourced from the community
 * credit-translation repo and keyed by the canonical NISO role URL:
 *   https://github.com/contributorshipcollaboration/credit-translation
 *
 * Output-only: this localizes the *displayed* role names in the generated
 * statement and human-facing exports (markdown, heatmap SVG). The data model
 * and CSV/XML/JSON interchange stay in canonical English.
 */

export interface RoleTranslation {
  name: string;
  description: string;
}

/** A locale's catalog, keyed by NISO role URL, matching the upstream `translations` object. */
export type RoleCatalog = Record<string, RoleTranslation>;

/** Maps a canonical English role name to its localized display name. */
export type RoleTranslator = (englishName: string) => string;

interface CatalogFile {
  default: { translations: RoleCatalog };
}

// One static import() per vendored locale so bundlers code-split each catalog
// (only the selected language ships to the client). Regenerate the JSON with
// scripts/fetch-credit-translations.mjs. The exhaustive key type makes adding
// a locale to AVAILABLE_LOCALES without a catalog here a compile error.
const LOADERS: Record<Exclude<LocaleCode, "en">, () => Promise<CatalogFile>> = {
  fr: () => import("./translations/fr.json"),
  de: () => import("./translations/de.json"),
  es: () => import("./translations/es.json"),
  it: () => import("./translations/it.json"),
  "pt-PT": () => import("./translations/pt.json"),
  nl: () => import("./translations/nl.json"),
  "zh-Hans": () => import("./translations/zh.json"),
  ja: () => import("./translations/ja.json"),
};

export interface LocaleInfo {
  code: string;
  name: string;
}

/** Locales offered in the output language picker. `en` is the canonical source (no catalog). */
/**
 * Every language the picker offers.
 *
 * `as const` so the codes form a literal union: the app types its interface
 * catalogs against {@link LocaleCode}, which turns "offered a language with no
 * interface strings" into a compile error instead of a silent English UI.
 */
export const AVAILABLE_LOCALES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "it", name: "Italiano" },
  { code: "pt-PT", name: "Português (Portugal)" },
  { code: "nl", name: "Nederlands" },
  // biome-ignore lint/security/noSecrets: native language name, not a credential
  { code: "zh-Hans", name: "简体中文" },
  { code: "ja", name: "日本語" },
] as const satisfies readonly LocaleInfo[];

/** A language code the picker offers. */
export type LocaleCode = (typeof AVAILABLE_LOCALES)[number]["code"];

const LOCALE_CODES = new Set<string>(AVAILABLE_LOCALES.map(({ code }) => code));

/**
 * Normalize stored locale identifiers and reject unsupported values.
 *
 * `pt` and `zh` shipped before their regional/script variants were made
 * explicit. Keep those drafts readable while all new state uses BCP 47 tags.
 */
export function normalizeLocaleCode(locale: unknown): LocaleCode {
  if (locale === "pt") return "pt-PT";
  if (locale === "zh") return "zh-Hans";
  return typeof locale === "string" && LOCALE_CODES.has(locale) ? (locale as LocaleCode) : "en";
}

/** Load a locale's role catalog. Returns null for `en` or any unknown locale (→ identity translator). */
export async function loadRoleCatalog(locale: string): Promise<RoleCatalog | null> {
  const loader = Object.hasOwn(LOADERS, locale) ? LOADERS[locale as Exclude<LocaleCode, "en">] : undefined;
  if (!loader) return null;
  const mod = await loader();
  return mod.default.translations;
}

/**
 * Build a role-name translator from a catalog. Maps English name → NISO URL →
 * localized name, falling back to the English name when the catalog is null or
 * lacks the role. Safe to call with any string (unknown names pass through).
 */
/** Maps a canonical English role name to its localized description. */
export type RoleDescriber = (englishName: string) => string;

/**
 * Localized role descriptions, from the same community catalog as the names.
 *
 * Descriptions are explanatory help and never reach an export, so the app reads
 * them in the *interface* language, while role names follow the *output*
 * language — a role name has to match the statement it will appear in.
 */
export function makeRoleDescriber(catalog: RoleCatalog | null | undefined, fallback: RoleDescriber): RoleDescriber {
  if (!catalog) return fallback;
  return (name) => {
    try {
      // `||` (not `??`) so an empty localized description falls back to English.
      return catalog[getRoleByName(name).url]?.description || fallback(name);
    } catch {
      return fallback(name);
    }
  };
}

export function makeRoleTranslator(catalog: RoleCatalog | null | undefined): RoleTranslator {
  if (!catalog) return (name) => name;
  return (name) => {
    try {
      // `||` (not `??`) so an empty localized name falls back to English.
      return catalog[getRoleByName(name).url]?.name || name;
    } catch {
      return name;
    }
  };
}

/** Identity role translator (no catalog): the canonical English default. */
export const DEFAULT_ROLE_TRANSLATOR: RoleTranslator = makeRoleTranslator(null);
