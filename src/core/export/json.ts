import * as z from "zod/mini";
import type { Ask } from "../ask";
import { AskSchema } from "../ask";
import type { Author } from "../author";
import { AuthorSchema, MAX_AUTHORS } from "../author";

/** The export format version this build writes and reads. */
export const JSON_EXPORT_VERSION = 1;

const ExportSchema = z.object({
  version: z.literal(JSON_EXPORT_VERSION),
  authors: z.array(AuthorSchema).check(z.maxLength(MAX_AUTHORS)),
  /** Asks and co-author answers by contributor id. Optional, so files from before them still load. */
  asks: z.optional(z.record(z.string(), AskSchema)),
});

/** Thrown by `fromJson` for an export stamped by a newer build. */
export class NewerVersionError extends Error {
  constructor(version: number) {
    super(`JSON export version ${version} is newer than ${JSON_EXPORT_VERSION}`);
    this.name = "NewerVersionError";
  }
}

/**
 * Serialize authors to a JSON string (pretty-printed). Asks and their answers
 * go in by default; `includeAnswers: false` leaves them out.
 */
export function toJson(
  authors: Author[],
  { asks, includeAnswers = true }: { asks?: Readonly<Record<string, Ask>>; includeAnswers?: boolean } = {},
): string {
  const ids = new Set(authors.map((author) => author.id));
  const kept = Object.entries(asks ?? {}).filter(([id]) => ids.has(id));
  const payload = ExportSchema.parse({
    version: JSON_EXPORT_VERSION,
    authors,
    ...(includeAnswers && kept.length > 0 ? { asks: Object.fromEntries(kept) } : {}),
  });
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse a JSON string previously produced by `toJson()`.
 * Throws a NewerVersionError for a newer build's export, and a ZodError for
 * any other data that doesn't match the expected shape.
 */
export function fromJson(json: string): { authors: Author[]; asks?: Record<string, Ask> } {
  const data: unknown = JSON.parse(json);
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version > JSON_EXPORT_VERSION) throw new NewerVersionError(version);
  const { authors, asks } = ExportSchema.parse(data);
  return asks ? { authors, asks } : { authors };
}
