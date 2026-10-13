import * as z from "zod/mini";
import type { Ask } from "../ask";
import { AskSchema } from "../ask";
import type { Author } from "../author";
import { AuthorSchema, MAX_AUTHORS } from "../author";

/** The export format version this build writes and reads. */
export const JSON_EXPORT_VERSION = 1;

const ExportSchema = /* @__PURE__ */ (() =>
  z.object({
    version: z.literal(JSON_EXPORT_VERSION),
    authors: z.array(AuthorSchema).check(z.maxLength(MAX_AUTHORS)),
    /** Asks and co-author answers by contributor id. Optional, so files from before them still load. */
    asks: z.optional(z.record(z.string(), AskSchema)),
    /** The contributor who made the file said they are. */
    selfId: z.optional(z.string()),
  }))();

/** Thrown by `fromJson` for an export stamped by a newer build. */
export class NewerVersionError extends Error {
  constructor(version: number) {
    super(`JSON export version ${version} is newer than ${JSON_EXPORT_VERSION}`);
    this.name = "NewerVersionError";
  }
}

/**
 * Serialize authors to a JSON string (pretty-printed). Asks and their answers
 * go in by default; `includeAnswers: false` leaves them out. `selfId` goes in
 * while it names a contributor in the file.
 */
export function toJson(
  authors: Author[],
  {
    asks,
    includeAnswers = true,
    selfId,
  }: { asks?: Readonly<Record<string, Ask>>; includeAnswers?: boolean; selfId?: string | null } = {},
): string {
  const ids = new Set(authors.map((author) => author.id));
  const kept = Object.entries(asks ?? {}).filter(([id]) => ids.has(id));
  const payload = ExportSchema.parse({
    version: JSON_EXPORT_VERSION,
    authors,
    ...(includeAnswers && kept.length > 0 ? { asks: Object.fromEntries(kept) } : {}),
    ...(selfId && ids.has(selfId) ? { selfId } : {}),
  });
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse a JSON string previously produced by `toJson()`.
 * Throws a NewerVersionError for a newer build's export, and a ZodError for
 * any other data that doesn't match the expected shape.
 */
export function fromJson(json: string): { authors: Author[]; asks?: Record<string, Ask>; selfId?: string } {
  const data: unknown = JSON.parse(json);
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version > JSON_EXPORT_VERSION) throw new NewerVersionError(version);
  const { authors, asks, selfId } = ExportSchema.parse(data);
  return { authors, ...(asks ? { asks } : {}), ...(selfId ? { selfId } : {}) };
}
