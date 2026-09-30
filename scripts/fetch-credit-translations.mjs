// Refreshes the vendored CRediT role translations from the community repo:
//   https://github.com/contributorshipcollaboration/credit-translation
//
// Downloads the curated locale set into src/core/credit-i18n/translations/ as
// pruned JSON (metadata.translators + translations only, no schema/render
// cruft). Run with `node scripts/fetch-credit-translations.mjs` and review the
// diff before committing.
//
// NOTE: the upstream repo has no top-level LICENSE; each file lists its
// translators (ORCIDs) for attribution. Confirm reuse terms with the
// maintainers before redistributing.

// biome-ignore-all lint/correctness/noNodejsModules: Node build script, not client code.
// biome-ignore-all lint/suspicious/noConsole: console is the script's progress output.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAW = "https://raw.githubusercontent.com/contributorshipcollaboration/credit-translation/main/translations";

// locale code (used by loadRoleCatalog) -> upstream <lang>_<script> file stem
const LOCALES = {
  fr: "fr_Latn",
  de: "de_Latn",
  es: "es_Latn",
  it: "it_Latn",
  "pt-PT": "pt_Latn",
  nl: "nl_Latn",
  "zh-Hans": "zh_Hans",
  ja: "ja_Jpan",
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "core", "credit-i18n", "translations");
await mkdir(outDir, { recursive: true });

const fmtTranslator = (t) => {
  const name = [t.firstName, t.middleName, t.lastName].filter(Boolean).join(" ");
  const orcid = (t.ORCID ?? "").replace(/https?:\/\/orcid\.org\//gi, "").trim();
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcid) ? `${name} (${orcid})` : name;
};

const creditRows = [];

for (const [code, stem] of Object.entries(LOCALES)) {
  const res = await fetch(`${RAW}/${stem}.json`);
  if (!res.ok) throw new Error(`${stem}: HTTP ${res.status}`);
  const full = await res.json();
  const translators = full.metadata?.translators ?? [];
  // Keep only what the app consumes; drop $schema/version/definitions.
  const pruned = {
    metadata: { languageName: full.metadata?.languageName, translators },
    translations: full.translations,
  };
  await writeFile(join(outDir, `${code}.json`), `${JSON.stringify(pruned, null, 2)}\n`);
  creditRows.push(`| ${full.metadata?.languageName ?? code} | ${translators.map(fmtTranslator).join("; ")} |`);
  console.log(`✓ ${code} (${stem}): ${Object.keys(full.translations).length} roles`);
}

// CC BY 4.0 attribution record: every vendored file is licensed CC BY 4.0 and
// requires crediting its translators + indicating that we modified it.
const credits = `# CRediT role translation credits

Role-name/description translations vendored here are from the community
[credit-translation](https://github.com/contributorshipcollaboration/credit-translation)
project, each licensed **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**.

**Modifications:** each source \`translations/<lang>.json\` was pruned to
\`metadata\` (languageName + translators) and \`translations\` only; no translated
text was altered.

| Language | Translators |
| --- | --- |
${creditRows.join("\n")}

Per-language license statements: https://github.com/contributorshipcollaboration/credit-translation/tree/main/md_files
`;
await writeFile(join(outDir, "CREDITS.md"), credits);
console.log("✓ CREDITS.md");
