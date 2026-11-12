import type { Ask } from "./ask";
import type { Author } from "./author";
import { isValidOrcid, MAX_AUTHORS, MAX_IMPORT_BYTES, normalizeOrcid } from "./author";
import { fromCrossrefContributors, isCrossrefContributors } from "./export/crossref";
import { fromCsv, headerCells } from "./export/csv";
import { fromJson, UNKNOWN_TOOLCHAIN_WARNING } from "./export/json";
import { fromTenzing, isTenzing } from "./export/tenzing";
import { fromJats4rXml, type XmlParser } from "./export/xml-import";
import { createAuthor, deduplicateAuthorInitials, splitNameList, tryCreateAuthor } from "./parse-authors";
import { decodeShareHash } from "./share-link";
import { readsAsStatement } from "./statement";
import type { Toolchain } from "./toolchain";

export type DetectedFormat =
  | "link"
  | "csv"
  | "tenzing"
  | "json"
  | "codemeta"
  | "cff"
  | "zenodo"
  | "xml"
  | "crossref"
  | "statement"
  | "names"
  | "unknown";

/** Guess what pasted or loaded text is, from its shape alone. */
export function detectFormat(text: string): DetectedFormat {
  const trimmed = text.trim();
  if (/^cff-version\s*:/m.test(trimmed)) return "cff";
  // A share link, most usefully one a co-author sent back with their own roles.
  // `encodeShareHash` without a base URL gives the bare `#s=…` hash.
  if (/^https?:\/\/\S+#s=/.test(trimmed) || /^#s=[\w-]+$/.test(trimmed)) return "link";
  if (isCrossrefContributors(trimmed)) return "crossref";
  if (trimmed.startsWith("<")) return "xml";
  // JSON must be checked before the CSV heuristic: a toJson() payload contains
  // both a comma and a "name" field, so the CSV check would misclassify it.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        if (Array.isArray(data.creators)) return "zenodo";
        if (JSON.stringify(data["@context"] ?? "").includes("codemeta") || data["@type"] === "SoftwareSourceCode")
          return "codemeta";
      }
      return "json";
    } catch {
      // A cut-off or damaged export: reading its lines as names would import garbage contributors.
      // `[not json, Name` stays a CSV header.
      if (/^(?:\{|\[\s*[{["])/.test(trimmed)) return "json";
    }
  }
  if (isTenzing(trimmed)) return "tenzing";
  // CSV only with a "Name" header cell: a pasted "Ada Lovelace, Alan Turing" is names.
  if (headerCells(trimmed).includes("name")) return "csv";
  // A name list never assigns "conceptualization" to initials or tells what the authors did.
  if (readsAsStatement(trimmed)) return "statement";
  if (trimmed.length > 0) return "names";
  return "unknown";
}

/** Thrown for text in a format the app writes but cannot read back: Quarto or MyST author YAML, an RO-Crate fragment. */
export class ExportOnlyError extends Error {
  override readonly name = "ExportOnlyError";

  constructor(format: string) {
    super(`${format} is export-only. Import the JSON export instead.`);
  }
}

// Author YAML from toQuarto/toMyst: leading comments, then a bare `author:` or `authors:` key.
const AUTHOR_YAML = /^(?:#[^\n]*\n)*authors?:(?: *\[\])? *(?:\n|$)/;

/**
 * The export-only format `trimmed` is, if any. A bare `author:` line is never a name list. YAML
 * keys come in any order, so a CITATION.cff may also open with `authors:`.
 */
function exportOnlyFormat(trimmed: string): string | undefined {
  if (AUTHOR_YAML.test(trimmed) && !/^cff-version\s*:/m.test(trimmed)) return "Quarto and MyST author YAML";
  if (trimmed.startsWith("{") && /"@context"\s*:\s*"https:\/\/w3id\.org\/ro\/crate\//.test(trimmed))
    return "An RO-Crate fragment";
  return undefined;
}

/** What {@link importAny} read. `asks` and `selfId` come only from JSON, `title` only from a link. */
export interface Imported {
  format: Exclude<DetectedFormat, "unknown" | "statement">;
  authors: Author[];
  asks?: Record<string, Ask>;
  selfId?: string;
  title?: string;
  toolchain?: Toolchain;
  /** What the import left out, for the reader; see `fromJson`. */
  warnings?: string[];
}

/**
 * Read text in any format {@link detectFormat} knows. Throws on text it cannot
 * place, on text the app only exports (`ExportOnlyError`), on a CRediT statement (it names roles, not contributors: read it with
 * `parseStatement` against your author list), on a link that does not decode, and whatever the format's own reader
 * throws (`NewerVersionError`, `ZodError`, an XML parse error). An empty
 * `authors` means the format was right but held nobody. A list of names longer than `MAX_AUTHORS`
 * comes back cut to `MAX_AUTHORS + 1`, which is still too many to use.
 */
export async function importAny(
  text: string,
  {
    parser,
    convertCitation,
  }: {
    parser?: XmlParser;
    /** Convert CFF or Zenodo metadata to CodeMeta through citesync. */
    convertCitation?: (text: string, format: "cff" | "zenodo") => Promise<string>;
  } = {},
): Promise<Imported> {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
    throw new Error(`Use a file smaller than ${MAX_IMPORT_BYTES / 1_000_000} MB.`);
  const trimmed = text.trim();
  const exportOnly = exportOnlyFormat(trimmed);
  if (exportOnly) throw new ExportOnlyError(exportOnly);
  const format = detectFormat(trimmed);
  switch (format) {
    case "cff":
    case "zenodo": {
      if (!convertCitation)
        throw new Error(
          "The web app converts CITATION.cff and .zenodo.json files. Here, convert the file to codemeta.json first.",
        );
      return { format, authors: fromCodemeta(await convertCitation(trimmed, format)) };
    }
    case "codemeta":
      return { format, authors: fromCodemeta(trimmed) };
    case "link": {
      const shared = await decodeShareHash(trimmed.slice(trimmed.indexOf("#")));
      if (!shared) throw new Error("The link is not a CRediT Matrix share link this version can read.");
      return {
        format,
        authors: shared.authors,
        title: shared.title,
        ...(shared.toolchain ? { toolchain: shared.toolchain } : {}),
        ...(shared.toolchainDropped ? { warnings: [UNKNOWN_TOOLCHAIN_WARNING] } : {}),
      };
    }
    case "json":
      return { format, ...fromJson(trimmed) };
    case "csv":
      return { format, authors: fromCsv(trimmed) };
    case "tenzing":
      return { format, authors: fromTenzing(trimmed) };
    case "xml":
      return { format, authors: fromJats4rXml(trimmed, { parser }) };
    case "crossref":
      return { format, authors: fromCrossrefContributors(trimmed, { parser }) };
    case "names": {
      // Past the cap every caller refuses the list, so create only one contributor more than
      // fits: a list at the size cap holds 200,000 names or more and costs hundreds of MB.
      const names = splitNameList(trimmed).slice(0, MAX_AUTHORS + 1);
      return { format, authors: deduplicateAuthorInitials(names.map((name) => createAuthor(name))) };
    }
    case "statement":
      throw new Error("A CRediT statement holds roles, not contributors. Read it with parseStatement.");
    default:
      throw new Error("Nothing to import.");
  }
}

/** Citation metadata supplies names and ORCIDs, never contribution scores. */
function fromCodemeta(text: string): Author[] {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
    throw new Error(`Use a file smaller than ${MAX_IMPORT_BYTES / 1_000_000} MB.`);
  const data = JSON.parse(text);
  const authors = readPeople(data?.author, "author");
  // Zenodo and CodeMeta often list a person as both author and contributor: keep the author row.
  const key = (person: Author) => person.orcid ?? person.name.toLowerCase();
  const listed = new Set(authors.map(key));
  const others = readPeople(data?.contributor, "non-author").filter((person) => !listed.has(key(person)));
  return deduplicateAuthorInitials([...authors, ...others]);
}

/** People in a CodeMeta field. Linked Roles and unusable entries are skipped one by one; the caller bounds the count. */
function readPeople(field: unknown, contributorType: Author["contributorType"]): Author[] {
  const entries: unknown[] = Array.isArray(field) ? field : field ? [field] : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const person = entry as Record<string, unknown>;
    if ((person["@type"] ?? person.type) === "Role") return [];
    const name = (
      typeof person.name === "string"
        ? person.name
        : [person.givenName, person.familyName].filter((part) => typeof part === "string").join(" ")
    ).replace(/\s+/g, " ");
    if (!name.trim()) return [];
    const id = person["@id"] ?? person.id;
    const organization = (person["@type"] ?? person.type) === "Organization";
    const orcid = !organization && typeof id === "string" && isValidOrcid(id) ? normalizeOrcid(id) : undefined;
    const given = typeof person.givenName === "string" ? person.givenName.trim().split(/\s+/) : [];
    return tryCreateAuthor(name, {
      contributorType,
      ...(orcid ? { orcid } : {}),
      ...(!organization && (typeof person.givenName === "string" || typeof person.familyName === "string")
        ? {
            firstName: given[0] ?? "",
            middleName: given.slice(1).join(" "),
            surname: typeof person.familyName === "string" ? person.familyName : "",
          }
        : {}),
    });
  });
}
