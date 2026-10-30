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
import type { Author } from "./author";
import {
  AVAILABLE_LOCALES,
  type LocaleCode,
  loadRoleCatalog,
  makeRoleTranslator,
  normalizeLocaleCode,
} from "./credit-i18n/index";
import { loadUiCatalog, makeUiTranslator } from "./credit-i18n/ui-strings";
import { toCodemetaRoles } from "./export/codemeta";
import { toCrossrefContributors } from "./export/crossref";
import { toCsv } from "./export/csv";
import { toJson } from "./export/json";
import { toMarkdown } from "./export/markdown";
import { toJats4rXml } from "./export/xml";
import type { XmlParser } from "./export/xml-import";
import { generateStatement, STATEMENT_FORMATS, type StatementFormat } from "./generate-statement";
import { importAny } from "./import";
import pkg from "./package.json" with { type: "json" };
import { normalizeRoster } from "./parse-authors";
import { encodeShareHash } from "./share-link";

export const USAGE = `Usage: credit-matrix <command> <file> [options]
       credit-matrix --help | --version

Read <file> (or - for standard input) in any format CRediT Matrix imports:
JSON, CSV, JATS4R XML, a share link, or a list of names.

Commands:
  statement <file> [--format ${[...STATEMENT_FORMATS, "codemeta"].join("|")}] [--locale <code>] [--levels]
      Print the CRediT statement. --levels adds Equal or Supporting after
      each contribution below Lead. Locales: ${AVAILABLE_LOCALES.map((l) => l.code).join(", ")}.
      --format codemeta prints CodeMeta 3.0 Role objects instead, one per
      role, for authors with an ORCID iD, and warns about each person left out.
  convert <file> --to json|csv|jats|crossref|md [--yes-no]
      Print the contributions in another format. --yes-no marks the roles
      as yes/no ticks: JATS then leaves out the lead/equal/supporting level.
      crossref prints the <contributors> block of a Crossref deposit (schema
      5.5.0), which has no levels.
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

const COMMANDS = ["statement", "convert", "ask"];

/** Thrown for a mistake in the command line: printed with a pointer to --help, exit code 2. */
class UsageError extends Error {}

const READ_ERRORS: Record<string, string> = {
  ENOENT: "no such file",
  EISDIR: "it is a directory",
  EACCES: "permission denied",
};

async function read(file: string): Promise<string> {
  let bytes: Buffer;
  if (file === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    bytes = Buffer.concat(chunks);
  } else {
    bytes = await readFile(file).catch((error: { code?: string; message: string }) => {
      throw new Error(`Cannot read ${file}: ${READ_ERRORS[error.code ?? ""] ?? error.message}.`);
    });
  }
  // Excel's "Unicode Text" export is UTF-16 with a byte order mark; decode it rather than refuse it.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  // A NUL byte never occurs in UTF-8 text; "PK\x03\x04" opens a ZIP, which .xlsx and .ods files are.
  if (/\.(xlsx?|ods)$/i.test(file) || bytes.includes(0) || bytes.subarray(0, 4).equals(ZIP_MAGIC)) {
    throw new Error("Excel and other spreadsheet files are not read: save the sheet as CSV first.");
  }
  return bytes.toString("utf8");
}

const ZIP_MAGIC = Buffer.from("PK\x03\x04", "latin1");

/** Levenshtein distance, for suggesting a command after a typo. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** The contributor `wanted` names: by id, full name, then a first name or surname only one person has. */
function findContributor(authors: Author[], wanted: string): Author {
  // Typed or pasted names may be decomposed (NFD); the roster is composed.
  const lower = wanted.normalize("NFC").toLowerCase();
  const exact =
    authors.find((a) => a.id === wanted) ?? authors.find((a) => a.name.normalize("NFC").toLowerCase() === lower);
  if (exact) return exact;
  const partial = authors.filter(
    (a) => a.firstName.normalize("NFC").toLowerCase() === lower || a.surname.normalize("NFC").toLowerCase() === lower,
  );
  if (partial.length === 1 && partial[0]) return partial[0];
  const listed = (partial.length > 1 ? partial : authors).map((a) => a.name);
  const names =
    listed.length > 10 ? `${listed.slice(0, 10).join(", ")} and ${listed.length - 10} more` : listed.join(", ");
  // The command line was fine; the file just has no such person, so this exits 1, not 2.
  throw new Error(
    partial.length > 1
      ? `${wanted} matches more than one contributor: ${names}. Give the full name or id.`
      : `No contributor named or with id ${wanted}. ${authors.length > 0 ? `Contributors: ${names}.` : "The file has no contributors."}`,
  );
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
      levels: { type: "boolean", default: false },
      "yes-no": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, file] = positionals;
  if (values.version) return pkg.version;
  if (values.help) return USAGE;
  if (!command) throw new UsageError(`Give a command: ${COMMANDS.join(", ")}.`);
  // Checked before reading the file too, so a typo does not wait on standard input.
  if (!COMMANDS.includes(command)) {
    const closest = COMMANDS.find((c) => distance(command, c) <= 2);
    throw new UsageError(`Unknown command: ${command}.${closest ? ` Did you mean '${closest}'?` : ""}`);
  }
  if (!file) throw new UsageError(`${command} needs a file.`);

  const imported = await importAny(await read(file), { parser }).catch((error: unknown) => {
    throw error instanceof z.core.$ZodError ? new Error(describeZodError(error, file)) : error;
  });
  const authors = normalizeRoster(imported.authors);

  switch (command) {
    case "statement": {
      const format = values.format;
      if (format === "codemeta") {
        const { roles, skipped } = toCodemetaRoles(authors);
        if (roles.length === 0 && skipped.length === 0)
          throw new Error("No roles assigned yet: the statement is empty.");
        for (const { author, reason } of skipped) {
          const why = reason === "non-author" ? "is not an author" : "has no ORCID iD";
          process.stderr.write(`credit-matrix: ${author.name} ${why}, so their roles are left out.\n`);
        }
        return JSON.stringify(roles, null, 2);
      }
      if (!isStatementFormat(format)) throw new UsageError(`Unknown format: ${format}`);
      const locale = resolveLocale(values.locale);
      if (!locale) {
        const codes = AVAILABLE_LOCALES.map((l) => l.code).join(", ");
        throw new UsageError(`Unknown locale: ${values.locale}. Use one of ${codes}.`);
      }
      const statement = generateStatement(authors, {
        format,
        locale,
        showLevels: values.levels,
        translateRole: makeRoleTranslator(await loadRoleCatalog(locale)),
        translateUi: makeUiTranslator(await loadUiCatalog(locale)),
      });
      if (!statement) throw new Error("No roles assigned yet: the statement is empty.");
      return statement;
    }
    case "convert":
      switch (values.to) {
        case "json":
          return toJson(authors, { asks: imported.asks, selfId: imported.selfId });
        case "csv":
          return toCsv(authors);
        case "jats":
          return toJats4rXml(authors, { yesNo: values["yes-no"] });
        case "crossref":
          return toCrossrefContributors(authors);
        case "md":
          return toMarkdown(authors);
        default:
          throw new UsageError("convert needs --to json, csv, jats, crossref or md.");
      }
    case "ask": {
      const wanted = values.contributor?.trim();
      if (!wanted) throw new UsageError("ask needs --contributor.");
      const author = findContributor(authors, wanted);
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
      const hint = usage ? "Run 'credit-matrix --help' for usage.\n" : "";
      process.stderr.write(`credit-matrix: ${(error as Error).message}\n${hint}`);
      process.exitCode = usage ? 2 : 1;
    },
  );
}
