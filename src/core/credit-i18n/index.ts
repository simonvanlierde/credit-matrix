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

export interface LocaleInfo {
  code: string;
  name: string;
}

/**
 * Every language the picker offers. `en` is the canonical source (no catalog).
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
 * Whether a locale has catalog files to load: an offered code other than
 * English, spelled exactly. Also what keeps an arbitrary string out of a
 * catalog import path. e2e/messages.spec.ts checks every offered code has its
 * files.
 */
export function hasCatalog(locale: string): locale is Exclude<LocaleCode, "en"> {
  return locale !== "en" && LOCALE_CODES.has(locale);
}

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
  if (!hasCatalog(locale)) return null;
  // A template import() code-splits one chunk per file, so only the selected
  // language ships. Regenerate the JSON with scripts/fetch-credit-translations.mjs.
  const mod: CatalogFile = await import(`./translations/${locale}.json`);
  return mod.default.translations;
}

/** Maps a canonical English role name to its localized description. */
export type RoleDescriber = (englishName: string) => string;

/**
 * Look one field of a role up in a catalog: English name → NISO URL → entry.
 * Falls back when the catalog is null, lacks the role, or holds an empty value
 * (`||`, not `??`). Safe to call with any string: unknown names fall back.
 */
function makeRoleLookup(
  catalog: RoleCatalog | null | undefined,
  field: keyof RoleTranslation,
  fallback: (name: string) => string,
): (name: string) => string {
  if (!catalog) return fallback;
  return (name) => {
    try {
      return catalog[getRoleByName(name).url]?.[field] || fallback(name);
    } catch {
      return fallback(name);
    }
  };
}

/** Localized role names; unknown or untranslated roles keep their English name. */
export function makeRoleTranslator(catalog: RoleCatalog | null | undefined): RoleTranslator {
  return makeRoleLookup(catalog, "name", (name) => name);
}

/**
 * Localized role descriptions, from the same community catalog as the names.
 *
 * Descriptions are explanatory help and never reach an export, so the app reads
 * them in the *interface* language, while role names follow the *output*
 * language — a role name has to match the statement it will appear in.
 */
export function makeRoleDescriber(catalog: RoleCatalog | null | undefined, fallback: RoleDescriber): RoleDescriber {
  return makeRoleLookup(catalog, "description", fallback);
}

/** Identity role translator (no catalog): the canonical English default. */
export const DEFAULT_ROLE_TRANSLATOR: RoleTranslator = makeRoleTranslator(null);
