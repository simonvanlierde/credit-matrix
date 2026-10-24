import type { Author } from "../author";
import { isValidOrcid } from "../author";
import { CREDIT_ROLES, headerKey as key } from "../credit-roles";
import { deduplicateAuthorInitials, tryCreateAuthor } from "../parse-authors";
import { delimiterOf, escapeCsvFormulaOnly, headerCells, parseCsvRecords, unescapeCsvValue } from "./csv";
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
  const name = author.name.trim().replace(/\s+/g, " ");
  const given = givenNamesOf(author);
  // Inverted input ("Curie, Marie") has no surname after its given names; split on a word, so
  // a first name "Ann" never takes "a" from "Anna".
  const surname = name === given || name.startsWith(`${given} `) ? name.slice(given.length).trim() : author.surname;
  const [first = "", ...middle] = given.split(/\s+/).filter(Boolean);
  return [first, middle.join(" "), surname];
}

/**
 * A draft as a tenzing contributor spreadsheet (CSV). tenzing records a role as
 * done or not, so any score above 0 becomes TRUE, and it has no column for equal
 * contribution. Rows run in byline order: authors in draft order, then the
 * acknowledgees, marked "Acknowledgment only" (the value tenzing keeps) and numbered
 * on from the authors, because tenzing refuses to build the acknowledgee section from
 * rows with no order.
 * Only a formula prefix (= + - @ tab CR) is guarded with an apostrophe, never a
 * leading apostrophe: tenzing does not undo the guard, so "'t Hooft" stays as it
 * is. "'+Pat" keeps its stray apostrophe in tenzing, to protect Excel users.
 * Columns this app does not hold are left empty for the team.
 */
export function toTenzing(authors: Author[]): string {
  const isAuthor = (author: Author) => author.contributorType === "author";
  const ordered = [...authors.filter(isAuthor), ...authors.filter((author) => !isAuthor(author))];
  const rows = ordered.map((author, index) => {
    const done = new Set(author.contributions.filter((c) => c.score > 0).map((c) => c.role));
    return [
      isAuthor(author) ? "Author" : "Acknowledgment only",
      String(index + 1),
      ...nameCells(author),
      ...CREDIT_ROLES.map((role) => trueFalse(done.has(role.name))),
      "",
      "",
      "",
      "",
      "",
      author.orcid ?? "",
      "",
      trueFalse(isAuthor(author) && author.corresponding),
      "",
    ];
  });
  return [TENZING_HEADERS, ...rows].map((cells) => cells.map(escapeCsvFormulaOnly).join(",")).join("\n");
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
      const status = cell(row, "author/acknowledgee");
      return { row, index, firstName, middleName, surname, status, order: Number.isNaN(order) ? Infinity : order };
    })
    // Template rows a team did not fill in.
    .filter((person) => person.firstName || person.middleName || person.surname)
    // tenzing's own "Don't agree to be named" (straight or curly apostrophe) is a person who opted out.
    .filter((person) => !/^don['’]t agree to be named$/i.test(person.status))
    .sort((a, b) => a.order - b.order || a.index - b.index);

  const authors = people.flatMap(({ row, firstName, middleName, surname, status }) => {
    const orcid = cell(row, "orcid id");
    return tryCreateAuthor([firstName, middleName, surname].filter(Boolean).join(" "), {
      firstName,
      middleName,
      surname,
      // Drop an unparseable ORCID rather than aborting the whole import.
      orcid: orcid && isValidOrcid(orcid) ? orcid : undefined,
      // "Acknowledgee" is the older spelling this app once wrote; tenzing itself keeps only "Acknowledgment only".
      contributorType: ["acknowledgment only", "acknowledgee"].includes(status.toLowerCase()) ? "non-author" : "author",
      corresponding: isTrue(cell(row, "corresponding author?")),
      // tenzing records a role as done or not, with no degree: done is the top score.
      contributions: [...ROLE_KEYS].map(([header, role]) => ({ role, score: isTrue(cell(row, header)) ? 100 : 0 })),
    });
  });

  return deduplicateAuthorInitials(authors);
}
