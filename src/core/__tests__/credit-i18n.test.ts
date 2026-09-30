// biome-ignore lint/correctness/noNodejsModules: the catalogs are checked on disk.
import { existsSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: the catalogs are checked on disk.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: the catalogs are checked on disk.
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  AVAILABLE_LOCALES,
  loadRoleCatalog,
  makeRoleDescriber,
  makeRoleTranslator,
  normalizeLocaleCode,
} from "../credit-i18n/index";
import { DEFAULT_UI_TRANSLATOR, loadUiCatalog, makeUiTranslator, type UiKey } from "../credit-i18n/ui-strings";
import { CREDIT_ROLES } from "../credit-roles";
import { generateStatement } from "../generate-statement";
import { parseAuthorText } from "../parse-authors";

function makeAuthors() {
  const authors = parseAuthorText("Jane Smith\nBob White");
  const [jane, bob] = authors;
  if (!(jane && bob)) throw new Error("expected 2 authors");
  const janeConc = jane.contributions[0]; // Conceptualization
  const bobInv = bob.contributions[4]; // Investigation
  if (!(janeConc && bobInv)) throw new Error("expected contributions");
  janeConc.score = 100;
  bobInv.score = 100;
  return authors;
}

/** Every locale offered besides `en`, which is the canonical source and ships no catalog. */
const CATALOG_LOCALES = AVAILABLE_LOCALES.map(({ code }) => code).filter((code) => code !== "en");

// The loaders import `<dir>/${code}.json` by name, so a missing or misnamed
// file only shows up at runtime, as an English fallback.
describe("shipped catalogs", () => {
  const dirs = ["src/messages", "src/core/credit-i18n/ui", "src/core/credit-i18n/translations"];
  it.each(dirs)("%s has a file for every locale the language picker offers", (dir) => {
    const missing = CATALOG_LOCALES.filter((code) => !existsSync(path.join(process.cwd(), dir, `${code}.json`)));
    expect(missing).toEqual([]);
  });
});

describe("makeRoleTranslator", () => {
  it("falls back to English when catalog is null", () => {
    const t = makeRoleTranslator(null);
    expect(t("Conceptualization")).toBe("Conceptualization");
  });

  it("passes through unknown role names without throwing", () => {
    const t = makeRoleTranslator({});
    expect(t("Not A Role")).toBe("Not A Role");
  });
});

describe("loadRoleCatalog", () => {
  it("returns null for en (canonical source) and unknown locales", async () => {
    expect(await loadRoleCatalog("en")).toBeNull();
    expect(await loadRoleCatalog("xx")).toBeNull();
  });

  it("localizes role names for a vendored locale", async () => {
    const catalog = await loadRoleCatalog("fr");
    const t = makeRoleTranslator(catalog);
    // From the credit-translation repo's fr_Latn.json.
    expect(t("Conceptualization")).toBe("Conceptualisation");
  });

  // Every offered language has to resolve its own loader: a catalog missed in
  // the regeneration script leaves that language silently English.
  it.each(CATALOG_LOCALES)("loads %s with a name and description for every CRediT role", async (locale) => {
    const catalog = await loadRoleCatalog(locale);
    expect(catalog).not.toBeNull();

    const translate = makeRoleTranslator(catalog);
    const describeRole = makeRoleDescriber(catalog, () => "");
    for (const role of CREDIT_ROLES) {
      expect(translate(role.name).trim()).not.toBe("");
      expect(describeRole(role.name).trim()).not.toBe("");
    }
  });
});

describe("makeRoleDescriber", () => {
  it("falls back for a null catalog, an unknown role, and a blank description", () => {
    const fallback = (name: string) => `English ${name}`;
    expect(makeRoleDescriber(null, fallback)("Conceptualization")).toBe("English Conceptualization");

    const url = CREDIT_ROLES[0]?.url ?? "";
    const describeRole = makeRoleDescriber({ [url]: { name: "Conceptualisation", description: "" } }, fallback);
    expect(describeRole("Conceptualization")).toBe("English Conceptualization");
    expect(describeRole("Not A Role")).toBe("English Not A Role");
  });
});

describe("normalizeLocaleCode", () => {
  it("migrates legacy locale aliases to explicit BCP 47 tags", () => {
    expect(normalizeLocaleCode("pt")).toBe("pt-PT");
    expect(normalizeLocaleCode("zh")).toBe("zh-Hans");
  });

  it("falls back to English for unsupported or malformed values", () => {
    expect(normalizeLocaleCode("xx")).toBe("en");
    expect(normalizeLocaleCode(null)).toBe("en");
  });
});

// Every key a UI catalog may contain.
const UI_KEYS: UiKey[] = [
  "acknowledgements",
  "lead",
  "equal",
  "supporting",
  "none",
  "contributed",
  "emptyState",
  "heatmapTitle",
  "equalContributionNote",
  "correspondenceNote",
  "nameListSeparator",
  "segmentSeparator",
  "levelAnnotation",
];

describe("loadUiCatalog", () => {
  it("returns null for en (canonical source) and unknown locales", async () => {
    expect(await loadUiCatalog("en")).toBeNull();
    expect(await loadUiCatalog("xx")).toBeNull();
  });

  it.each(CATALOG_LOCALES)("loads %s with every known key populated", async (locale) => {
    const catalog = await loadUiCatalog(locale);
    expect(catalog).not.toBeNull();

    const entries = Object.entries(catalog ?? {});
    expect(entries).toHaveLength(UI_KEYS.length);
    for (const [key, value] of entries) {
      // Catches a key left behind after a rename or removal, which would
      // otherwise sit in the catalogs untranslated and unnoticed.
      expect(UI_KEYS).toContain(key);
      expect(value.trim()).not.toBe("");
    }
  });
});

describe("makeUiTranslator", () => {
  it("falls back to English for a missing or blank override", () => {
    const t = makeUiTranslator({ lead: "Principal", equal: "" });
    expect(t("lead")).toBe("Principal");
    expect(t("equal")).toBe("Equal"); // blank override → English, not a blank label
    expect(t("none")).toBe("None"); // absent from the catalog → English
    expect(DEFAULT_UI_TRANSLATOR("acknowledgements")).toBe("Acknowledgements");
  });
});

describe("generateStatement with translateRole", () => {
  it("translates role names while keeping the CRediT: scaffolding English", async () => {
    const t = makeRoleTranslator(await loadRoleCatalog("fr"));
    const stmt = generateStatement(makeAuthors(), { format: "by-role", translateRole: t });
    expect(stmt).toMatch(/^CRediT: /);
    expect(stmt).toContain("Conceptualisation: Jane Smith");
    expect(stmt).not.toContain("Conceptualization:");
  });

  // Separators carry meaningful whitespace: trimming them ran names together.
  it("keeps the spaces in localized separators", async () => {
    const translateUi = makeUiTranslator(await loadUiCatalog("de"));
    const authors = makeAuthors();
    const bobConc = authors[1]?.contributions[0];
    if (!bobConc) throw new Error("expected contributions");
    bobConc.score = 100;
    const stmt = generateStatement(authors, { format: "by-role", translateUi });
    expect(stmt).toContain("Jane Smith, Bob White");
    expect(stmt).toMatch(/Bob White; \S/);
  });
});
