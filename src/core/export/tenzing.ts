import type { Author } from "../author";
import { isValidOrcid } from "../author";
import { CREDIT_ROLES, headerKey as key } from "../credit-roles";
import { deduplicateAuthorInitials, tryCreateAuthor } from "../parse-authors";
import { delimiterOf, escapeCsvValue, headerCells, parseCsvRecords, unescapeCsvValue } from "./csv";
import { givenNamesOf } from "./xml";

/*
 * tenzing (github.com/marton-balazs-kovacs/tenzing) contributor spreadsheets,
 * saved as CSV or TSV. Its own example CSV and its R template disagree on column
 * order and on "Notes" vs "Note", so columns are found by header name, never by
 * position.
 */

const ROLE_KEYS = new Map(CREDIT_ROLES.map((role) => [key(role.name), role.name]));

// The column order of tenzing's example CSV. tenzing spells the writing roles with a hyphen.
const TENZING_HEADERS = [
  "Author/Acknowledgee",
  "Order in publication",
  "Firstname",
  "Middle name",
  "Surname",
  ...CREDIT_ROLES.map((role) => role.name.replace("–", "-")),
  "Notes",
  "Affiliation 1",
  "Affiliation 2",
  "Affiliation 3",
  "Funding",
  "ORCID iD",
  "Email address",
  "Corresponding author?",
  "Declares",
];

function trueFalse(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

/**
 * Firstname, middle name and surname cells that join back into the display name.
 * The parsed parts drop punctuation and every word past the second, so
 * "Martin Luther King Jr." would come back as "Martin Luther Jr".
 */
function nameCells(author: Author): string[] {
  const name = author.name.trim();
  const given = givenNamesOf(author);
  // Inverted input ("Curie, Marie") has no surname after its given names.
  const surname = name.startsWith(given) ? name.slice(given.length).trim() : author.surname;
  const [first = "", ...middle] = given.split(/\s+/).filter(Boolean);
  return [first, middle.join(" "), surname];
}

/**
 * A draft as a tenzing contributor spreadsheet (CSV). tenzing records a role as
 * done or not, so any score above 0 becomes TRUE, and it has no column for equal
 * contribution. Authors are numbered in draft order; acknowledgees get NA, as in
 * tenzing's example. Columns this app does not hold are left empty for the team.
 */
export function toTenzing(authors: Author[]): string {
  const byline = authors.filter((author) => author.contributorType === "author");
  const rows = authors.map((author) => {
    const isAuthor = author.contributorType === "author";
    const done = new Set(author.contributions.filter((c) => c.score > 0).map((c) => c.role));
    return [
      isAuthor ? "Author" : "Acknowledgee",
      isAuthor ? String(byline.indexOf(author) + 1) : "NA",
      ...nameCells(author),
      ...CREDIT_ROLES.map((role) => trueFalse(done.has(role.name))),
      "",
      "",
      "",
      "",
      "",
      author.orcid ?? "",
      "",
      trueFalse(author.corresponding),
      "",
    ];
  });
  return [TENZING_HEADERS, ...rows].map((cells) => cells.map(escapeCsvValue).join(",")).join("\n");
}

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
  // Undo the formula guard toTenzing adds, as fromCsv does.
  const cell = (row: string[], header: string) => unescapeCsvValue(row[column.get(header) ?? -1]?.trim() ?? "");

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

  const authors = people.flatMap(({ row, firstName, middleName, surname }) => {
    const orcid = cell(row, "orcid id");
    return tryCreateAuthor([firstName, middleName, surname].filter(Boolean).join(" "), {
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
