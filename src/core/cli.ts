#!/usr/bin/env node
// biome-ignore-all lint/correctness/noNodejsModules: the CLI runs in Node.
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DOMParser } from "linkedom";
import { core } from "zod/mini";
import { hasCatalog, loadRoleCatalog, makeRoleTranslator } from "./credit-i18n/index";
import { loadUiCatalog, makeUiTranslator } from "./credit-i18n/ui-strings";
import { toCsv } from "./export/csv";
import { toJson } from "./export/json";
import { toMarkdown } from "./export/markdown";
import { toJats4rXml } from "./export/xml";
import type { XmlParser } from "./export/xml-import";
import { generateStatement, type StatementFormat } from "./generate-statement";
import { importAny } from "./import";
import { normalizeRoster } from "./parse-authors";
import { encodeShareHash } from "./share-link";

export const USAGE = `Usage: credit-matrix <command> <file> [options]

Read <file> (or - for standard input) in any format CRediT Matrix imports:
JSON, CSV, JATS4R XML, a share link, or a list of names.

Commands:
  statement <file> [--format by-role|by-author|by-role-short|by-author-short] [--locale <code>]
      Print the CRediT statement.
  convert <file> --to json|csv|jats|md
      Print the contributions in another format.
  ask <file> --contributor <name or id> [--blank] [--base-url <url>]
      Print a link that asks one contributor to check their roles,
      or with --blank, to fill them in from scratch.
`;

const FORMATS: readonly string[] = ["by-role", "by-author", "by-role-short", "by-author-short"];
const DEFAULT_BASE_URL = "https://credit.duinlab.nl/";
// linkedom's DOMParser types its result as its own Document, which fits XmlParser structurally at run time.
const parser = new DOMParser() as unknown as XmlParser;

/** Thrown for a mistake in the command line: printed with the usage, exit code 2. */
class UsageError extends Error {}

async function read(file: string): Promise<string> {
  if (file !== "-") return readFile(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Run one command line (without `node` and the script) and return what to print. */
export async function run(argv: string[]): Promise<string> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: "string", default: "by-role" },
      locale: { type: "string", default: "en" },
      to: { type: "string" },
      contributor: { type: "string" },
      blank: { type: "boolean", default: false },
      "base-url": { type: "string", default: DEFAULT_BASE_URL },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, file] = positionals;
  if (values.help || !command) return USAGE;
  if (!["statement", "convert", "ask"].includes(command)) throw new UsageError(`Unknown command: ${command}`);
  if (!file) throw new UsageError(`${command} needs a file.`);

  const imported = await importAny(await read(file), { parser }).catch((error: unknown) => {
    if (!(error instanceof core.$ZodError)) throw error;
    // zod's own message is a JSON dump of every issue: name the fields that failed instead.
    const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "the top level"))];
    const listed =
      fields.length > 3 ? `${fields.slice(0, 3).join(", ")} and ${fields.length - 3} more` : fields.join(", ");
    throw new Error(`${file === "-" ? "The input" : file} is not a CRediT Matrix JSON export. Check ${listed}.`);
  });
  const authors = normalizeRoster(imported.authors);

  switch (command) {
    case "statement": {
      if (!FORMATS.includes(values.format)) throw new UsageError(`Unknown format: ${values.format}`);
      const locale = values.locale;
      if (locale !== "en" && !hasCatalog(locale)) throw new UsageError(`Unknown locale: ${locale}`);
      return generateStatement(authors, {
        format: values.format as StatementFormat,
        locale,
        translateRole: makeRoleTranslator(await loadRoleCatalog(locale)),
        translateUi: makeUiTranslator(await loadUiCatalog(locale)),
      });
    }
    case "convert":
      switch (values.to) {
        case "json":
          return toJson(authors, { asks: imported.asks, selfId: imported.selfId });
        case "csv":
          return toCsv(authors);
        case "jats":
          return toJats4rXml(authors);
        case "md":
          return toMarkdown(authors);
        default:
          throw new UsageError("convert needs --to json, csv, jats or md.");
      }
    default: {
      // Only "ask" is left: every other command was refused above.
      const wanted = values.contributor?.trim();
      if (!wanted) throw new UsageError("ask needs --contributor.");
      const author =
        authors.find((a) => a.id === wanted) ?? authors.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
      if (!author) throw new UsageError(`No contributor named or with id ${wanted}.`);
      return encodeShareHash(
        {
          authors,
          title: imported.title,
          claimId: author.id,
          // The asker has no draft here; the reply link still decodes with `convert`.
          sourceDraftId: randomUUID(),
          blank: values.blank,
          sentAt: Date.now(),
        },
        values["base-url"],
      );
    }
  }
}

// Only when run as a program (also through the npm bin symlink), not when a test imports run().
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (output) => process.stdout.write(output.endsWith("\n") ? output : `${output}\n`),
    (error: unknown) => {
      const usage = error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
      process.stderr.write(`credit-matrix: ${(error as Error).message}\n${usage ? `\n${USAGE}` : ""}`);
      process.exitCode = usage ? 2 : 1;
    },
  );
}
