import type { Contribution, Contributor } from "../author";
import { clampScore, isGroup, isPerson, isValidOrcid, isValidRor, LEVEL_SCORE, normalizeRor, orcidOf } from "../author";
import { CREDIT_ROLES, headerKey } from "../credit-roles";
import { deduplicateAuthorInitials, readUpToCap, tryCreateAuthor, tryCreateGroup } from "../parse-authors";

const NAME_HEADER = "Name";
const ORCID_HEADER = "ORCID";
const TYPE_HEADER = "Type";
const EQUAL_HEADER = "Equal contribution";
const CORRESPONDING_HEADER = "Corresponding";

/** Written only when the draft holds a group, so a roster of people keeps the columns it always had. */
const KIND_HEADER = "Kind";
const ALIAS_HEADER = "Alias";
const ROR_HEADER = "ROR";
const MEMBERS_HEADER = "Members";
const GROUP_HEADERS = [KIND_HEADER, ALIAS_HEADER, ROR_HEADER, MEMBERS_HEADER];
/** Between members in the Members cell; names are split on it again, so a comma in a name is safe. */
const MEMBER_SEPARATOR = "; ";

const BASE_HEADERS = [NAME_HEADER, ORCID_HEADER, TYPE_HEADER, EQUAL_HEADER, CORRESPONDING_HEADER];
const csvHeaders = (withGroups: boolean) => [
  ...BASE_HEADERS,
  ...(withGroups ? GROUP_HEADERS : []),
  ...CREDIT_ROLES.map((role) => role.name),
];

/** Markers are written as yes/no, which reads in a spreadsheet and parses back. */
function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** A score cell that is not a number, a level or yes/no. `row` counts the header as row 1, as a spreadsheet does. */
export class ScoreCellError extends Error {
  constructor(
    readonly row: number,
    readonly column: string,
    readonly value: string,
  ) {
    super(`Row ${row}, column "${column}": "${value}" is not a score. Use 0 to 100, a level (Lead) or yes/no.`);
    this.name = "ScoreCellError";
  }
}

/** Checkbox-style cells a person ticking roles in a spreadsheet writes. */
const TICK_SCORE: Record<string, number> = {
  yes: LEVEL_SCORE.lead,
  x: LEVEL_SCORE.lead,
  true: LEVEL_SCORE.lead,
  "✓": LEVEL_SCORE.lead,
  "✔": LEVEL_SCORE.lead,
  no: 0,
  false: 0,
  "-": 0,
};

/** A trimmed score cell: empty, a number, a level word ("Lead") or a tick ("yes", "x"). Undefined for anything else. */
function readScore(value: string): number | undefined {
  const cell = value.toLowerCase();
  if (Object.hasOwn(LEVEL_SCORE, cell)) return LEVEL_SCORE[cell as keyof typeof LEVEL_SCORE];
  if (Object.hasOwn(TICK_SCORE, cell)) return TICK_SCORE[cell];
  // "0,5" from a sheet saved where the comma is the decimal mark, "50%" from a percentage cell.
  const score = Number(cell.replace(",", ".").replace(/%$/, ""));
  return Number.isFinite(score) ? clampScore(score) : undefined;
}

function readYesNo(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "yes";
}

/** Leading characters a spreadsheet may interpret as the start of a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function quoteCsvValue(value: string, guardApostrophe: boolean): string {
  // Prefix a single quote so Excel/Sheets treat formula-like cells as text.
  // A value that already starts with `'` is guarded too, so the unescape below
  // is a true inverse (otherwise a genuine leading apostrophe would be stripped).
  const guarded = (guardApostrophe && value.startsWith("'")) || FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (/["\r\n,]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function escapeCsvValue(raw: string): string {
  // Import trims a cell before it reads the guard, so decide on the trimmed value.
  return quoteCsvValue(raw.trim(), true);
}

/**
 * Like `escapeCsvValue`, but leaves a leading apostrophe alone. For readers that
 * do not undo the guard, where `'t Hooft` would otherwise show as `''t Hooft`.
 */
export function escapeCsvFormulaOnly(raw: string): string {
  return quoteCsvValue(raw.trim(), false);
}

/** Inverse of the formula guard added by `escapeCsvValue`. */
export function unescapeCsvValue(value: string): string {
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

export function toCsv(authors: Contributor[]): string {
  const withGroups = authors.some(isGroup);
  const rows = [
    csvHeaders(withGroups).map(escapeCsvValue).join(","),
    ...authors.map((author) => {
      const contributionByRole = new Map(
        author.contributions.map((contribution) => [contribution.role, contribution.score]),
      );

      return [
        author.name,
        orcidOf(author) ?? "",
        author.contributorType,
        yesNo(isPerson(author) && author.equalContribution),
        yesNo(isPerson(author) && author.corresponding),
        ...(withGroups
          ? isGroup(author)
            ? [
                "group",
                author.alias ?? "",
                author.ror ? `https://ror.org/${author.ror}` : "",
                author.members.map((m) => m.name).join(MEMBER_SEPARATOR),
              ]
            : ["person", "", "", ""]
          : []),
        ...CREDIT_ROLES.map((role) => String(contributionByRole.get(role.name) ?? 0)),
      ]
        .map(escapeCsvValue)
        .join(",");
    }),
  ];

  return rows.join("\n");
}

/** Read people from a CSV, stopping one past `MAX_AUTHORS`: refuse a result longer than that. */
export function fromCsv(csv: string): Contributor[] {
  // Each record keeps its spreadsheet row number, for the score cell error.
  const records = parseCsvRecords(csv, delimiterOf(csv))
    .map((cells, index) =>
      Object.assign(
        cells.map((cell) => unescapeCsvValue(cell.trim())),
        { row: index + 1 },
      ),
    )
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
  const kindIndex = headers.indexOf(headerKey(KIND_HEADER));
  const aliasIndex = headers.indexOf(headerKey(ALIAS_HEADER));
  const rorIndex = headers.indexOf(headerKey(ROR_HEADER));
  const membersIndex = headers.indexOf(headerKey(MEMBERS_HEADER));
  const roleIndexes = CREDIT_ROLES.map((role) => headers.indexOf(headerKey(role.name)));

  // A row with no usable name is skipped, as JATS import skips a nameless
  // contrib, rather than aborting the whole import.
  const authors = readUpToCap<string[] & { row: number }, Contributor>(records.slice(1), (cells) => {
    const name = cells[nameIndex] ?? "";
    if (!name) return [];

    const contributions: Contribution[] = CREDIT_ROLES.map((role, i) => {
      const column = roleIndexes[i] ?? -1;
      const cell = cells[column] ?? "";
      const score = readScore(cell);
      if (score === undefined)
        throw new ScoreCellError(cells.row, records[0]?.[column] ?? "", Array.from(cell).slice(0, 40).join(""));
      return { role: role.name, score };
    });

    const contributorType = headerKey(cells[typeIndex] ?? "") === "non-author" ? "non-author" : "author";
    // Drop an unparseable ORCID rather than aborting the whole import.
    const orcid = cells[orcidIndex];

    if (headerKey(cells[kindIndex] ?? "") === "group") {
      const alias = cells[aliasIndex];
      const ror = normalizeRor(cells[rorIndex] ?? "");
      return tryCreateGroup(name, {
        contributorType,
        contributions,
        ...(alias ? { alias } : {}),
        ...(isValidRor(ror) ? { ror } : {}),
        members: (cells[membersIndex] ?? "")
          .split(";")
          .map((member) => ({ name: member.trim() }))
          .filter((member) => member.name),
      });
    }

    return tryCreateAuthor(name, {
      orcid: orcid && isValidOrcid(orcid) ? orcid : undefined,
      contributorType,
      contributions,
      equalContribution: readYesNo(cells[equalIndex]),
      corresponding: readYesNo(cells[correspondingIndex]),
    });
  });

  return deduplicateAuthorInitials(authors);
}
