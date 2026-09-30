import * as z from "zod/mini";
import { isValidOrcid, MAX_AUTHORS, normalizeOrcid } from "./author";
import { fetchUpstreamJson } from "./upstream-fetch";

/**
 * Stable machine-readable failure codes.
 *
 * The client localizes from the code; the `error` string beside it stays English
 * for logs and `curl`. Codes are API surface: add rather than rename.
 */
export type DoiErrorCode = "INVALID_DOI" | "NOT_FOUND" | "NO_AUTHORS" | "TOO_MANY_AUTHORS" | "UNAVAILABLE";

/** English fallback text, one per code. Not the localized copy the UI renders. */
const MESSAGES: Record<DoiErrorCode, string> = {
  INVALID_DOI: "That is not a valid DOI. It should look like 10.1234/abcde.",
  NOT_FOUND: "No published record matches that DOI.",
  NO_AUTHORS: "That record lists no contributors, so there is nothing to import.",
  TOO_MANY_AUTHORS: `That record lists more than ${MAX_AUTHORS} contributors, which is more than a draft can hold.`,
  UNAVAILABLE: "The DOI lookup service is unavailable. Try again shortly, or paste the author list.",
};

/** Resolver prefixes stripped on input: doi.org and dx.doi.org, with or without a scheme or `www.`, plus a bare `doi:`. */
const DOI_PREFIX = /^(?:(?:https?:\/\/)?(?:www\.)?(?:dx\.)?doi\.org\/|doi:)\s*/i;

/**
 * DOI accepted on input: bare form, a `doi:` prefix, or a doi.org URL. The
 * suffix is capped at 300 characters: real DOIs stay far below that, and the
 * value is forwarded upstream.
 */
export const DOI_INPUT_REGEX = /^(?:(?:https?:\/\/)?(?:www\.)?(?:dx\.)?doi\.org\/|doi:)?\s*10\.\d{4,9}\/\S{1,300}$/i;

export interface DoiAuthor {
  name: string;
  orcid?: string;
}

export type DoiLookupResult =
  | { ok: true; title: string; authors: DoiAuthor[] }
  | { ok: false; status: 400 | 404 | 422 | 502; code: DoiErrorCode; error: string };

/**
 * Crossref's shape is loose: `title` is an array, a contributor carries
 * `given`/`family` or a bare `name`, and `ORCID` may be a URL. Parse
 * permissively and let the reader below decide what is usable.
 */
const CrossrefWorkSchema = z.object({
  message: z.object({
    title: z.optional(z.array(z.string())),
    author: z.optional(
      z.array(
        z.object({
          given: z.optional(z.string()),
          family: z.optional(z.string()),
          name: z.optional(z.string()),
          ORCID: z.optional(z.string()),
        }),
      ),
    ),
  }),
});

/**
 * DataCite (arXiv, Zenodo, Figshare and other repository DOIs) is not in
 * Crossref. Its JSON:API body nests everything under `data.attributes`; a
 * creator has `givenName`/`familyName` or only `name`, and an ORCID arrives in
 * `nameIdentifiers` tagged by scheme.
 */
const DataCiteWorkSchema = z.object({
  data: z.object({
    attributes: z.object({
      titles: z.optional(z.array(z.object({ title: z.optional(z.string()) }))),
      creators: z.optional(
        z.array(
          z.object({
            givenName: z.optional(z.string()),
            familyName: z.optional(z.string()),
            name: z.optional(z.string()),
            nameIdentifiers: z.optional(
              z.array(
                z.object({
                  nameIdentifier: z.optional(z.string()),
                  nameIdentifierScheme: z.optional(z.string()),
                }),
              ),
            ),
          }),
        ),
      ),
    }),
  }),
});

/** The contributor shape both lookups are reduced to before reading. */
type CrossrefAuthor = { given?: string; family?: string; name?: string; ORCID?: string };

/** Build a failure carrying both the code and its English description. */
function fail(status: 400 | 404 | 422 | 502, code: DoiErrorCode): DoiLookupResult {
  return { ok: false, status, code, error: MESSAGES[code] };
}

/**
 * Return the canonical DOI form used in requests: no resolver prefix, no
 * surrounding space. Case is left alone — the registrant half of a DOI is
 * case-insensitive but the suffix is not, so lowercasing can break resolution.
 */
export function normalizeDoi(doi: string): string {
  return doi.trim().replace(DOI_PREFIX, "").trim();
}

/**
 * Resolve a DOI to its title and contributor list through an injected fetcher,
 * asking Crossref first and DataCite when Crossref has no such record.
 *
 * Pass `mailto` to join Crossref's "polite pool", which gets faster and more
 * reliable service than the anonymous pool.
 */
export async function lookupDoiWork(
  doi: string,
  fetcher: typeof fetch = fetch,
  mailto?: string,
): Promise<DoiLookupResult> {
  const normalized = normalizeDoi(doi);
  if (!DOI_INPUT_REGEX.test(normalized)) return fail(400, "INVALID_DOI");

  const politeSuffix = mailto ? `?mailto=${encodeURIComponent(mailto)}` : "";
  const upstream = await fetchUpstreamJson(
    `https://api.crossref.org/works/${encodeURIComponent(normalized)}${politeSuffix}`,
    fetcher,
  );
  // Crossref only knows its own registrant DOIs; ask DataCite before giving up.
  if (upstream.kind === "not-found") return lookupDataCite(normalized, fetcher);
  if (upstream.kind !== "ok") return fail(502, "UNAVAILABLE");

  const parsed = CrossrefWorkSchema.safeParse(upstream.body);
  if (!parsed.success) return fail(502, "UNAVAILABLE");

  return toResult(parsed.data.message.title?.[0], parsed.data.message.author ?? []);
}

async function lookupDataCite(doi: string, fetcher: typeof fetch): Promise<DoiLookupResult> {
  const upstream = await fetchUpstreamJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, fetcher);
  if (upstream.kind === "not-found") return fail(404, "NOT_FOUND");
  if (upstream.kind !== "ok") return fail(502, "UNAVAILABLE");

  const parsed = DataCiteWorkSchema.safeParse(upstream.body);
  if (!parsed.success) return fail(502, "UNAVAILABLE");

  const { titles, creators } = parsed.data.data.attributes;
  // Prefer given/family: DataCite's own `name` is "Family, Given", which would
  // import backwards. It is the fallback for organisations, which have no split.
  const entries = (creators ?? []).map((creator) => ({
    given: creator.givenName,
    family: creator.familyName,
    name: creator.givenName || creator.familyName ? undefined : creator.name,
    ORCID: creator.nameIdentifiers?.find((id) => id.nameIdentifierScheme?.toUpperCase() === "ORCID")?.nameIdentifier,
  }));
  return toResult(titles?.[0]?.title, entries);
}

/** Shared tail of both lookups: apply the author-count rules and read each entry. */
function toResult(title: string | undefined, entries: CrossrefAuthor[]): DoiLookupResult {
  // Reject on the raw count, before dropping unusable entries: a 300-author
  // record should say "too many", not quietly import the 199 it could read.
  if (entries.length > MAX_AUTHORS) return fail(422, "TOO_MANY_AUTHORS");

  const authors = entries.map(readAuthor).filter((author): author is DoiAuthor => author !== null);
  if (authors.length === 0) return fail(422, "NO_AUTHORS");

  return { ok: true, title: title?.trim() ?? "", authors };
}

/**
 * Read one contributor. Returns null when there is no usable name —
 * a consortium entry with neither `name` nor `family` is not importable.
 *
 * An ORCID that fails its checksum is dropped rather than fatal: the name is
 * still worth having, and exporting an unverified iD would be worse.
 */
function readAuthor(entry: CrossrefAuthor): DoiAuthor | null {
  const name = (entry.name?.trim() || `${entry.given?.trim() ?? ""} ${entry.family?.trim() ?? ""}`.trim()).replace(
    /\s+/g,
    " ",
  );
  if (!name) return null;

  // Crossref sends the URL form; `normalizeOrcid` already strips it.
  const orcid = entry.ORCID ? normalizeOrcid(entry.ORCID) : "";
  return isValidOrcid(orcid) ? { name, orcid } : { name };
}
