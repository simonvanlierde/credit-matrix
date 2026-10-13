#!/usr/bin/env node
// biome-ignore-all lint/correctness/noNodejsModules: the CLI runs in Node.
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DOMParser } from "linkedom";
import * as z from "zod/mini";
import { type LocaleCode, loadRoleCatalog, makeRoleTranslator, normalizeLocaleCode } from "./credit-i18n/index";
import { loadUiCatalog, makeUiTranslator } from "./credit-i18n/ui-strings";
import { toCsv } from "./export/csv";
import { toJson } from "./export/json";
import { toMarkdown } from "./export/markdown";
import { toJats4rXml } from "./export/xml";
import type { XmlParser } from "./export/xml-import";
import { generateStatement, STATEMENT_FORMATS, type StatementFormat } from "./generate-statement";
import { importAny } from "./import";
import { normalizeRoster } from "./parse-authors";
import { encodeShareHash } from "./share-link";

export const USAGE = `Usage: credit-matrix <command> <file> [options]

Read <file> (or - for standard input) in any format CRediT Matrix imports:
JSON, CSV, JATS4R XML, a share link, or a list of names.

Commands:
  statement <file> [--format ${STATEMENT_FORMATS.join("|")}] [--locale <code>]
      Print the CRediT statement.
  convert <file> --to json|csv|jats|md
      Print the contributions in another format.
  ask <file> --contributor <name or id> [--blank] [--base-url <url>]
      Print a link that asks one contributor to check their roles,
      or with --blank, to fill them in from scratch.
`;

const DEFAULT_BASE_URL = "https://credit.duinlab.nl/";
const linkedom = new DOMParser();
const parser: XmlParser = {
  parseFromString(xml) {
    // linkedom never reports a parse error (htmlparser2 closes open tags silently), so check tag balance here rather than add a strict parser dependency.
    assertBalancedTags(xml);
    // linkedom types its result as its own Document, which fits XmlParser structurally at run time.
    return linkedom.parseFromString(xml, "text/xml") as unknown as ReturnType<XmlParser["parseFromString"]>;
  },
};

/** Throws on a tag left open, closed out of order, or cut off: what a truncated file looks like. */
function assertBalancedTags(xml: string): void {
  // Comments, CDATA, processing instructions and the doctype match without a name and are skipped.
  const token =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>!?]+)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;
  const open: string[] = [];
  let end = 0;
  for (const match of xml.matchAll(token)) {
    // A "<" between tokens starts something no token matched: a tag or comment cut off.
    if (xml.slice(end, match.index).includes("<")) throw new Error("XML parse error: a tag is cut off.");
    end = match.index + match[0].length;
    const [, closing, name, selfClosing] = match;
    if (name === undefined) continue;
    if (closing) {
      if (open.pop() !== name) throw new Error(`XML parse error: unexpected </${name}>.`);
    } else if (!selfClosing) {
      open.push(name);
    }
  }
  if (xml.slice(end).includes("<")) throw new Error("XML parse error: a tag is cut off.");
  if (open.length > 0) throw new Error(`XML parse error: <${open.at(-1)}> is never closed.`);
}

function isStatementFormat(format: string): format is StatementFormat {
  return (STATEMENT_FORMATS as readonly string[]).includes(format);
}

/** A locale code, or its language alone ("de-DE" → "de", "pt-BR" → "pt-PT"); null when neither is offered. */
function resolveLocale(code: string): LocaleCode | null {
  for (const candidate of [code, code.split("-")[0]?.toLowerCase() ?? ""]) {
    if (candidate === "en") return "en";
    const locale = normalizeLocaleCode(candidate);
    if (locale !== "en") return locale;
  }
  return null;
}

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
  // Checked before reading the file too, so a typo does not wait on standard input.
  if (!["statement", "convert", "ask"].includes(command)) throw new UsageError(`Unknown command: ${command}`);
  if (!file) throw new UsageError(`${command} needs a file.`);

  const imported = await importAny(await read(file), { parser }).catch((error: unknown) => {
    throw error instanceof z.core.$ZodError ? new Error(describeZodError(error, file)) : error;
  });
  const authors = normalizeRoster(imported.authors);

  switch (command) {
    case "statement": {
      const format = values.format;
      if (!isStatementFormat(format)) throw new UsageError(`Unknown format: ${format}`);
      const locale = resolveLocale(values.locale);
      if (!locale) throw new UsageError(`Unknown locale: ${values.locale}`);
      return generateStatement(authors, {
        format,
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
    case "ask": {
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
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

/** Why JSON failed validation as an export, in one line: up to three failing fields and a count of the rest. */
function describeZodError(error: z.core.$ZodError, file: string): string {
  // zod's own message is a JSON dump of every issue: name the fields that failed instead.
  const fields = [...new Set(error.issues.map((issue) => issue.path.map(String).join(".") || "the top level"))];
  const listed =
    fields.length > 3 ? `${fields.slice(0, 3).join(", ")} and ${fields.length - 3} more` : fields.join(", ");
  return `${file === "-" ? "The input" : file} is not a CRediT Matrix JSON export. Check ${listed}.`;
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
