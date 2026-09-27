import type { Author, Contribution } from "../author";
import { clampScore, isValidOrcid } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
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
function parseCsvRecords(csv: string): string[][] {
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

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
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
  const records = parseCsvRecords(csv)
    .map((cells) => cells.map((cell) => unescapeCsvValue(cell.trim())))
    .filter((cells) => cells.some((cell) => cell !== ""));

  if (records.length === 0) return [];

  const headers = records[0] ?? [];
  const nameIndex = headers.indexOf(NAME_HEADER);
  if (nameIndex === -1) {
    throw new Error('CSV must include a "Name" column.');
  }

  const orcidIndex = headers.indexOf(ORCID_HEADER);
  const typeIndex = headers.indexOf(TYPE_HEADER);
  // Absent in a CSV written before these columns existed; `indexOf` returns -1
  // and the lookup below reads as "no", which is the right default.
  const equalIndex = headers.indexOf(EQUAL_HEADER);
  const correspondingIndex = headers.indexOf(CORRESPONDING_HEADER);
  const roleIndexByHeader = new Map(headers.map((header, index) => [header, index]));

  const authors = records.slice(1).map((cells) => {
    const name = cells[nameIndex] ?? "";
    if (!name) {
      throw new Error("Each CSV row must include a contributor name.");
    }

    const contributions: Contribution[] = CREDIT_ROLES.map((role) => {
      const scoreText = cells[roleIndexByHeader.get(role.name) ?? -1] ?? "0";
      return { role: role.name, score: clampScore(Number(scoreText)) };
    });

    const contributorType = cells[typeIndex] === "non-author" ? "non-author" : "author";
    // Drop an unparseable ORCID rather than aborting the whole import.
    const orcid = cells[orcidIndex];

    return createAuthor(name, {
      orcid: orcid && isValidOrcid(orcid) ? orcid : undefined,
      contributorType,
      contributions,
      equalContribution: readYesNo(cells[equalIndex]),
      corresponding: readYesNo(cells[correspondingIndex]),
    });
  });

  return deduplicateAuthorInitials(authors);
}
