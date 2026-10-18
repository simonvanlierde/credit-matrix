import { type Author, CREDIT_ROLES, type CreditRoleName } from "@/core";
import data from "@/data/field-norms.json";

/** Where an author sits in the byline, as the census counts it. */
export type Position = "single" | "first" | "middle" | "last";

export const POSITIONS: readonly Position[] = ["single", "first", "middle", "last"];

/** The shape `census norms` writes; see census/src/census/norms.py. */
export interface FieldNorms {
  snapshot: string;
  dataset_version: string;
  code_commit: string | null;
  /** Date of the newest Europe PMC bulk file read, YYYY-MM-DD. */
  files_date: string | null;
  /** Parser F1 against publisher tags over every tagged article, and how many articles that is. */
  parser_f1: number | null;
  parser_f1_articles: number;
  min_articles: number;
  min_authors: number;
  positions: string[];
  /** Role slugs from credit.niso.org, in the order of each shares list. */
  roles: string[];
  fields: Record<
    string,
    { articles: number; authors: Record<string, number>; shares: Record<string, number[] | null> }
  >;
}

export const NORMS = data as FieldNorms;

/** Field names in alphabetical order. They are OpenAlex's English names, so they sort the same in every locale. */
export const NORM_FIELDS = Object.keys(NORMS.fields).sort((a, b) => a.localeCompare(b, "en"));

/** The byline position of the author at `index` among `count` authors, or null when there is no such author. */
export function positionOf(index: number, count: number): Position | null {
  if (index < 0 || index >= count) return null;
  if (count === 1) return "single";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

/**
 * Where `selfId` sits among the authors only, as the census counts the byline: non-authors sit in
 * the acknowledgements, not the byline. "non-author" when that contributor is one, null when nobody is marked.
 */
export function selfPosition(authors: readonly Author[], selfId: string | null): Position | "non-author" | null {
  const self = authors.find((author) => author.id === selfId);
  if (!self) return null;
  if (self.contributorType === "non-author") return "non-author";
  const byline = authors.filter((author) => author.contributorType !== "non-author");
  return positionOf(byline.indexOf(self), byline.length);
}

export interface NormRow {
  role: CreditRoleName;
  /** Share of authors in that position given the role, 0..1, or null when too few authors to say. */
  shares: Record<Position, number | null>;
}

/** One row per CRediT role, in the app's role order, for a field; null for a field the file does not hold. */
export function normRows(field: string | null, norms: FieldNorms = NORMS): NormRow[] | null {
  const entry = field ? norms.fields[field] : undefined;
  if (!entry) return null;
  return CREDIT_ROLES.map((role) => {
    const slug = role.url.split("/").at(-2) ?? "";
    const column = norms.roles.indexOf(slug);
    const shares = Object.fromEntries(
      POSITIONS.map((position) => [position, entry.shares[position]?.[column] ?? null]),
    ) as Record<Position, number | null>;
    return { role: role.name, shares };
  });
}
