import * as z from "zod/mini";
import type { Author } from "../author";
import { AuthorSchema, MAX_AUTHORS } from "../author";

/** The export format version this build writes and reads. */
export const JSON_EXPORT_VERSION = 1;

const ExportSchema = z.object({
  version: z.literal(JSON_EXPORT_VERSION),
  authors: z.array(AuthorSchema).check(z.maxLength(MAX_AUTHORS)),
});

/** Thrown by `fromJson` for an export stamped by a newer build. */
export class NewerVersionError extends Error {
  constructor(version: number) {
    super(`JSON export version ${version} is newer than ${JSON_EXPORT_VERSION}`);
    this.name = "NewerVersionError";
  }
}

/** Serialize authors to a JSON string (pretty-printed). */
export function toJson(authors: Author[]): string {
  const payload = ExportSchema.parse({ version: JSON_EXPORT_VERSION, authors });
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse a JSON string previously produced by `toJson()`.
 * Throws a NewerVersionError for a newer build's export, and a ZodError for
 * any other data that doesn't match the expected shape.
 */
export function fromJson(json: string): Author[] {
  const data: unknown = JSON.parse(json);
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version > JSON_EXPORT_VERSION) throw new NewerVersionError(version);
  return ExportSchema.parse(data).authors;
}
