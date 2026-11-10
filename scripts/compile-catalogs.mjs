// biome-ignore-all lint/correctness/noNodejsModules: localization build script.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { parsePoFile } from "@lingui/format-po";

const source = parsePoFile(await readFile("src/locales/en/messages.po", "utf8"));
const keys = source.items.filter(({ obsolete }) => !obsolete).map(({ msgid }) => msgid);
await writeFile(
  "src/locales/keys.ts",
  `// Generated from the English PO catalog by pnpm i18n:compile.\nexport type MessageKey =\n${keys.map((key) => `  | ${JSON.stringify(key)}`).join("\n")};\n`,
);
execFileSync("pnpm", ["exec", "lingui", "compile", "--typescript", "--strict"], { stdio: "inherit" });
