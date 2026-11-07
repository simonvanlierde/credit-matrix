import type { Ask } from "./ask";
import type { Author } from "./author";
import { isValidOrcid, MAX_AUTHORS, MAX_IMPORT_BYTES, normalizeOrcid } from "./author";
import { fromCrossrefContributors, isCrossrefContributors } from "./export/crossref";
import { fromCsv, headerCells } from "./export/csv";
import { fromJson } from "./export/json";
import { fromTenzing, isTenzing } from "./export/tenzing";
import { fromJats4rXml, type XmlParser } from "./export/xml-import";
import { createAuthor, deduplicateAuthorInitials, parseAuthorText } from "./parse-authors";
import { decodeShareHash } from "./share-link";
import { readsAsStatement } from "./statement";

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
      /* fall through */
    }
  }
  if (isTenzing(trimmed)) return "tenzing";
  // CSV only with a "Name" header cell: a pasted "Anne Namer, Bob Smith" is names.
  if (headerCells(trimmed).includes("name")) return "csv";
  // A name list never assigns "conceptualization" to initials or tells what the authors did.
  if (readsAsStatement(trimmed)) return "statement";
  if (trimmed.length > 0) return "names";
  return "unknown";
}

/** What {@link importAny} read. `asks` and `selfId` come only from JSON, `title` only from a link. */
export interface Imported {
  format: Exclude<DetectedFormat, "unknown" | "statement">;
  authors: Author[];
  asks?: Record<string, Ask>;
  selfId?: string;
  title?: string;
}

/**
 * Read text in any format {@link detectFormat} knows. Throws on text it cannot
 * place, on a CRediT statement (it names roles, not contributors: read it with
 * `parseStatement` against your author list), on a link that does not decode, and whatever the format's own reader
 * throws (`NewerVersionError`, `ZodError`, an XML parse error). An empty
 * `authors` means the format was right but held nobody.
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
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("Use a file smaller than 1 MB.");
  const trimmed = text.trim();
  const format = detectFormat(trimmed);
  switch (format) {
    case "cff":
    case "zenodo": {
      if (!convertCitation) throw new Error("This citation format needs the citesync converter.");
      return { format, authors: fromCodemeta(await convertCitation(trimmed, format)) };
    }
    case "codemeta":
      return { format, authors: fromCodemeta(trimmed) };
    case "link": {
      const shared = await decodeShareHash(trimmed.slice(trimmed.indexOf("#")));
      if (!shared) throw new Error("The link is not a CRediT Matrix share link this version can read.");
      return { format, authors: shared.authors, title: shared.title };
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
    case "names":
      return { format, authors: parseAuthorText(trimmed) };
    case "statement":
      throw new Error("A CRediT statement holds roles, not contributors. Read it with parseStatement.");
    default:
      throw new Error("Nothing to import.");
  }
}

/** Citation metadata supplies names and ORCIDs, never contribution scores. */
function fromCodemeta(text: string): Author[] {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("Use a file smaller than 1 MB.");
  const data = JSON.parse(text);
  const entries: unknown[] = Array.isArray(data?.author) ? data.author : data?.author ? [data.author] : [];
  const people = entries.filter(
    (entry) =>
      !entry ||
      typeof entry !== "object" ||
      ((entry as Record<string, unknown>)["@type"] ?? (entry as Record<string, unknown>).type) !== "Role",
  );
  if (people.length > MAX_AUTHORS) throw new Error("Too many contributors.");
  return deduplicateAuthorInitials(
    people.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const person = entry as Record<string, unknown>;
      const name =
        typeof person.name === "string"
          ? person.name.trim()
          : [person.givenName, person.familyName]
              .filter((part) => typeof part === "string")
              .join(" ")
              .trim();
      if (!name) return [];
      const id = person["@id"] ?? person.id;
      const organization = (person["@type"] ?? person.type) === "Organization";
      const orcid = !organization && typeof id === "string" && isValidOrcid(id) ? normalizeOrcid(id) : undefined;
      const given = typeof person.givenName === "string" ? person.givenName.trim().split(/\s+/) : [];
      return [
        createAuthor(name, {
          ...(orcid ? { orcid } : {}),
          ...(!organization && (typeof person.givenName === "string" || typeof person.familyName === "string")
            ? {
                firstName: given[0] ?? "",
                middleName: given.slice(1).join(" "),
                surname: typeof person.familyName === "string" ? person.familyName : "",
              }
            : {}),
        }),
      ];
    }),
  );
}
