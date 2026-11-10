// biome-ignore-all lint/correctness/noNodejsModules: source catalogs used only by tests.
import { readFileSync } from "node:fs";
import { parsePoFile } from "@lingui/format-po";
import type { MessageKey } from "@/locales/keys";

export const english = Object.fromEntries(
  parsePoFile(readFileSync("src/locales/en/messages.po", "utf8")).items.map(({ msgid, msgstr }) => [msgid, msgstr[0]]),
) as Record<MessageKey, string>;
