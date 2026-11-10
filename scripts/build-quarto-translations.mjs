// biome-ignore-all lint/correctness/noNodejsModules: Node build script, not client code.
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parsePoFile } from "@lingui/format-po";

const UI_KEYS = ["equal", "supporting", "labelSeparator", "nameListSeparator", "segmentSeparator", "levelAnnotation"];

/** The standalone Lua filter keeps generated translations inline, so no sidecar needs installing. */
export async function renderQuartoTranslations(i18n, roles) {
  const lines = [
    "-- BEGIN GENERATED TRANSLATIONS",
    "-- From scripts/build-quarto-translations.mjs; do not edit.",
    "local TRANSLATIONS = {",
  ];
  for (const { code } of i18n.AVAILABLE_LOCALES) {
    const role = i18n.makeRoleTranslator(await i18n.loadRoleCatalog(code));
    const ui = i18n.makeUiTranslator(await i18n.loadUiCatalog(code));
    const po = parsePoFile(await readFile(new URL(`../src/locales/${code}/messages.po`, import.meta.url), "utf8"));
    const heading =
      code === "en"
        ? "CRediT authorship contribution statement"
        : po.items.find(({ msgid }) => msgid === "formatStatement").msgstr[0];
    lines.push(`  [${JSON.stringify(code)}] = {`, `    heading = ${JSON.stringify(heading)},`, "    roles = {");
    for (const { name } of roles)
      lines.push(`      [${JSON.stringify(name.toLowerCase())}] = ${JSON.stringify(role(name))},`);
    lines.push("    },", "    ui = {");
    for (const key of UI_KEYS) lines.push(`      ${key} = ${JSON.stringify(ui(key))},`);
    lines.push("    },", "  },");
  }
  return [...lines, "}", "-- END GENERATED TRANSLATIONS"].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i18n = await import("../src/core/dist/i18n.js");
  const { CREDIT_ROLES } = await import("../src/core/dist/index.js");
  const target = new URL("../integrations/quarto/_extensions/credit-matrix/credit-matrix.lua", import.meta.url);
  const source = await readFile(target, "utf8");
  await writeFile(
    target,
    source.replace(
      /-- BEGIN GENERATED TRANSLATIONS[\s\S]*?-- END GENERATED TRANSLATIONS/,
      await renderQuartoTranslations(i18n, CREDIT_ROLES),
    ),
  );
}
