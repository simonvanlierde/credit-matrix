import type { Author } from "../author";
import { isValidOrcid } from "../author";
import { CREDIT_ROLES, headerKey as key } from "../credit-roles";
import { createAuthor, deduplicateAuthorInitials } from "../parse-authors";
import { delimiterOf, headerCells, parseCsvRecords } from "./csv";

/*
 * tenzing (github.com/marton-balazs-kovacs/tenzing) contributor spreadsheets,
 * saved as CSV or TSV. Its own example CSV and its R template disagree on column
 * order and on "Notes" vs "Note", so columns are found by header name, never by
 * position.
 */

const ROLE_KEYS = new Map(CREDIT_ROLES.map((role) => [key(role.name), role.name]));

/** True for a header row that looks like a tenzing contributor spreadsheet. */
export function isTenzing(text: string): boolean {
  const headers = headerCells(text).map(key);
  if (headers.includes("author/acknowledgee")) return true;
  return headers.includes("firstname") && headers.filter((header) => ROLE_KEYS.has(header)).length >= 10;
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function fromTenzing(text: string): Author[] {
  const trimmed = text.replace(/^﻿/, "").trim();
  const [headerRow = [], ...rows] = parseCsvRecords(trimmed, delimiterOf(trimmed));
  const column = new Map<string, number>();
  // The first of two same-named columns wins, so a stray empty copy cannot blank a filled one.
  for (const [index, header] of headerRow.entries()) {
    if (!column.has(key(header))) column.set(key(header), index);
  }
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
