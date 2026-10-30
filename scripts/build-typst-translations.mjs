// Writes integrations/typst/translations.json, the role names and statement wording the Typst
// package reads, from the core's catalogs (src/core/credit-i18n). Run after a core build:
//   pnpm --filter credit-matrix build && node scripts/build-typst-translations.mjs
// integrations/typst/credit-matrix.test.ts fails when the file is stale.

// biome-ignore-all lint/correctness/noNodejsModules: Node build script, not client code.

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const UI_KEYS = [
  "acknowledgements",
  "lead",
  "equal",
  "supporting",
  "none",
  "contributed",
  "heatmapTitle",
  "equalContributionNote",
  "correspondenceNote",
  "nameListSeparator",
  "segmentSeparator",
  "levelAnnotation",
];

/** The separators CLDR puts between list items ("A, B, and C"), so Typst can join names alike. */
function listSeparators(locale) {
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const between = (text, a, b) => text.slice(text.indexOf(a) + a.length, text.indexOf(b));
  const four = list.format(["\u0001", "\u0002", "\u0003", "\u0004"]);
  return {
    pair: between(list.format(["\u0001", "\u0002"]), "\u0001", "\u0002"),
    start: between(four, "\u0001", "\u0002"),
    middle: between(four, "\u0002", "\u0003"),
    end: between(four, "\u0003", "\u0004"),
  };
}

/**
 * The file's text. `i18n` is the core's `credit-matrix/i18n` module and `roles` its CREDIT_ROLES,
 * passed in so the test can hand over the source and the script the build.
 */
export async function renderTypstTranslations(i18n, roles) {
  const slug = (role) => role.url.split("/").at(-2);
  const locales = {};
  for (const { code } of i18n.AVAILABLE_LOCALES) {
    const role = i18n.makeRoleTranslator(await i18n.loadRoleCatalog(code));
    const ui = i18n.makeUiTranslator(await i18n.loadUiCatalog(code));
    locales[code] = {
      roles: Object.fromEntries(roles.map((r) => [slug(r), role(r.name)])),
      ui: Object.fromEntries(UI_KEYS.map((key) => [key, ui(key)])),
      list: listSeparators(code),
    };
  }
  const data = {
    generated: "By scripts/build-typst-translations.mjs from src/core/credit-i18n. Do not edit.",
    roles: roles.map((r) => ({ slug: slug(r), name: r.name })),
    locales,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i18n = await import("../src/core/dist/i18n.js");
  const { CREDIT_ROLES } = await import("../src/core/dist/index.js");
  const out = fileURLToPath(new URL("../integrations/typst/translations.json", import.meta.url));
  await writeFile(out, await renderTypstTranslations(i18n, CREDIT_ROLES));
}
