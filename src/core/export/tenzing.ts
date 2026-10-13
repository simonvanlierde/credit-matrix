import type { Author } from "../author";
import { isValidOrcid } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { createAuthor, deduplicateAuthorInitials } from "../parse-authors";
import { parseCsvRecords } from "./csv";

/*
 * tenzing (github.com/marton-balazs-kovacs/tenzing) contributor spreadsheets,
 * saved as CSV or TSV. Its own example CSV and its R template disagree on column
 * order and on "Notes" vs "Note", so columns are found by header name, never by
 * position.
 */

/** Compare headers ignoring case, spacing, quotes and the kind of dash. */
function key(header: string): string {
  return header
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .toLowerCase()
    .replace(/[‐-―-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const ROLE_KEYS = new Map(CREDIT_ROLES.map((role) => [key(role.name), role.name]));

/** Tab-separated when the header has more tabs than commas. */
function delimiterOf(headerLine: string): string {
  return (headerLine.match(/\t/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
}

function firstLine(text: string): string {
  return text.slice(0, text.search(/\r?\n|$/));
}

/** True for a header row that looks like a tenzing contributor spreadsheet. */
export function isTenzing(text: string): boolean {
  const headerLine = firstLine(text.trim());
  const headers = headerLine.split(delimiterOf(headerLine)).map(key);
  if (headers.includes("author/acknowledgee")) return true;
  return headers.includes("firstname") && headers.filter((header) => ROLE_KEYS.has(header)).length >= 10;
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function fromTenzing(text: string): Author[] {
  const trimmed = text.replace(/^﻿/, "").trim();
  const [headerRow = [], ...rows] = parseCsvRecords(trimmed, delimiterOf(firstLine(trimmed)));
  const column = new Map(headerRow.map((header, index) => [key(header), index]));
  const cell = (row: string[], header: string) => row[column.get(header) ?? -1]?.trim() ?? "";

  const people = rows
    .map((row, index) => {
      const firstName = cell(row, "firstname");
      const middleName = cell(row, "middle name");
      const surname = cell(row, "surname");
      const order = Number.parseFloat(cell(row, "order in publication"));
      return { row, index, firstName, middleName, surname, order: Number.isNaN(order) ? Infinity : order };
    })
    // Template rows a team did not fill in.
    .filter((person) => person.firstName || person.middleName || person.surname)
    .sort((a, b) => a.order - b.order || a.index - b.index);

  const authors = people.map(({ row, firstName, middleName, surname }) => {
    const orcid = cell(row, "orcid id");
    return createAuthor([firstName, middleName, surname].filter(Boolean).join(" "), {
      firstName,
      middleName,
      surname,
      // Drop an unparseable ORCID rather than aborting the whole import.
      orcid: orcid && isValidOrcid(orcid) ? orcid : undefined,
      contributorType: cell(row, "author/acknowledgee").toLowerCase() === "acknowledgee" ? "non-author" : "author",
      corresponding: isTrue(cell(row, "corresponding author?")),
      // tenzing records a role as done or not, with no degree: done is the top score.
      contributions: [...ROLE_KEYS].map(([header, role]) => ({ role, score: isTrue(cell(row, header)) ? 100 : 0 })),
    });
  });

  return deduplicateAuthorInitials(authors);
}
