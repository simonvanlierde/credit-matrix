import type { Author, Contribution } from "../author";
import { clampScore, isValidOrcid, LEVEL_SCORE } from "../author";
import { CREDIT_ROLES, headerKey } from "../credit-roles";
import { createAuthor, deduplicateAuthorInitials } from "../parse-authors";

const NAME_HEADER = "Name";
const ORCID_HEADER = "ORCID";
const TYPE_HEADER = "Type";
const EQUAL_HEADER = "Equal contribution";
const CORRESPONDING_HEADER = "Corresponding";

const CSV_HEADERS = [
  NAME_HEADER,
  ORCID_HEADER,
  TYPE_HEADER,
  EQUAL_HEADER,
  CORRESPONDING_HEADER,
  ...CREDIT_ROLES.map((role) => role.name),
];

/** Markers are written as yes/no, which reads in a spreadsheet and parses back. */
function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** A score cell: a number, or a level word ("Lead") as a person typing one would write it. */
function readScore(value: string): number {
  const level = value.trim().toLowerCase();
  return Object.hasOwn(LEVEL_SCORE, level) ? LEVEL_SCORE[level as keyof typeof LEVEL_SCORE] : clampScore(Number(value));
}

function readYesNo(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "yes";
}

/** Leading characters a spreadsheet may interpret as the start of a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCsvValue(value: string): string {
  // Prefix a single quote so Excel/Sheets treat formula-like cells as text.
  // Also guard values that already start with `'` so the unescape below is a
  // true inverse (otherwise a genuine leading apostrophe would be stripped).
  const guarded = value.startsWith("'") || FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (/["\r\n,]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Inverse of the formula guard added by `escapeCsvValue`. */
function unescapeCsvValue(value: string): string {
  return value.startsWith("'") && (value[1] === "'" || FORMULA_PREFIX.test(value.slice(1))) ? value.slice(1) : value;
}

/**
 * Split raw CSV into records of fields, honoring RFC-4180 quoting, including
 * commas and newlines *inside* quoted fields. (Splitting on newlines first, as
 * a naive parser does, tears a quoted multi-line field into broken rows.)
 */
export function parseCsvRecords(csv: string, delimiter = ","): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];

    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    // Only a quote that opens a field starts quoting, after any spaces (`a, "b"`); one mid-field ("O"Brien") is data.
    if (char === '"' && field.trim() === "") {
      inQuotes = true;
      field = "";
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      records.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  records.push(row);
  return records;
}

function firstLine(text: string): string {
  return text.slice(0, text.search(/\r?\n|$/));
}

/**
 * The delimiter a sheet uses: whichever of comma, semicolon and tab is most
 * frequent in its first line, comma on a tie. Excel saves CSV with `;` in
 * locales where the comma is the decimal mark (nl, de, fr).
 */
export function delimiterOf(text: string): string {
  const line = firstLine(text);
  const count = (delimiter: string) => line.split(delimiter).length;
  return [";", "\t"].reduce((best, delimiter) => (count(delimiter) > count(best) ? delimiter : best), ",");
}

/** The first row's cells, unquoted, trimmed and lower-cased, split on {@link delimiterOf}. */
export function headerCells(text: string): string[] {
  const line = firstLine(text.replace(/^﻿/, "").trim());
  return (parseCsvRecords(line, delimiterOf(line))[0] ?? []).map((cell) => cell.trim().toLowerCase());
}

export function toCsv(authors: Author[]): string {
  const rows = [
    CSV_HEADERS.map(escapeCsvValue).join(","),
    ...authors.map((author) => {
      const contributionByRole = new Map(
        author.contributions.map((contribution) => [contribution.role, contribution.score]),
      );

      return [
        author.name,
        author.orcid ?? "",
        author.contributorType,
        yesNo(author.equalContribution),
        yesNo(author.corresponding),
        ...CREDIT_ROLES.map((role) => String(contributionByRole.get(role.name) ?? 0)),
      ]
        .map(escapeCsvValue)
        .join(",");
    }),
  ];

  return rows.join("\n");
}

export function fromCsv(csv: string): Author[] {
  const records = parseCsvRecords(csv, delimiterOf(csv))
    .map((cells) => cells.map((cell) => unescapeCsvValue(cell.trim())))
    .filter((cells) => cells.some((cell) => cell !== ""));

  if (records.length === 0) return [];

  // Headers match whatever their case or dash, as `detectFormat` finds them.
  const headers = (records[0] ?? []).map(headerKey);
  const nameIndex = headers.indexOf(headerKey(NAME_HEADER));
  if (nameIndex === -1) {
    throw new Error('CSV must include a "Name" column.');
  }

  const orcidIndex = headers.indexOf(headerKey(ORCID_HEADER));
  const typeIndex = headers.indexOf(headerKey(TYPE_HEADER));
  // Absent in a CSV written before these columns existed; `indexOf` returns -1
  // and the lookup below reads as "no", which is the right default.
  const equalIndex = headers.indexOf(headerKey(EQUAL_HEADER));
  const correspondingIndex = headers.indexOf(headerKey(CORRESPONDING_HEADER));

  // A row with no usable name is skipped, as JATS import skips a nameless
  // contrib, rather than aborting the whole import.
  const authors = records.slice(1).flatMap((cells) => {
    const name = cells[nameIndex] ?? "";
    if (!name) return [];

    const contributions: Contribution[] = CREDIT_ROLES.map((role) => {
      const scoreText = cells[headers.indexOf(headerKey(role.name))] ?? "0";
      return { role: role.name, score: readScore(scoreText) };
    });

    const contributorType = headerKey(cells[typeIndex] ?? "") === "non-author" ? "non-author" : "author";
    // Drop an unparseable ORCID rather than aborting the whole import.
    const orcid = cells[orcidIndex];

    try {
      return [
        createAuthor(name, {
          orcid: orcid && isValidOrcid(orcid) ? orcid : undefined,
          contributorType,
          contributions,
          equalContribution: readYesNo(cells[equalIndex]),
          corresponding: readYesNo(cells[correspondingIndex]),
        }),
      ];
    } catch {
      return [];
    }
  });

  return deduplicateAuthorInitials(authors);
}
