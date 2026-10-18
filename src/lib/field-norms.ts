import { CREDIT_ROLES, type CreditRoleName } from "@/core";
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

/** Field names, largest first, as the file lists them. */
export const NORM_FIELDS = Object.keys(NORMS.fields);

/** The byline position of the author at `index` among `count` authors, or null when there is no such author. */
export function positionOf(index: number, count: number): Position | null {
  if (index < 0 || index >= count) return null;
  if (count === 1) return "single";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
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
