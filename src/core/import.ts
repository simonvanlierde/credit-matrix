import type { Ask } from "./ask";
import type { Author } from "./author";
import { fromCsv, headerCells } from "./export/csv";
import { fromJson } from "./export/json";
import { fromTenzing, isTenzing } from "./export/tenzing";
import { fromJats4rXml, type XmlParser } from "./export/xml-import";
import { parseAuthorText } from "./parse-authors";
import { decodeShareHash } from "./share-link";

export type DetectedFormat = "link" | "csv" | "tenzing" | "json" | "xml" | "names" | "unknown";

/** Guess what pasted or loaded text is, from its shape alone. */
export function detectFormat(text: string): DetectedFormat {
  const trimmed = text.trim();
  // A share link, most usefully one a co-author sent back with their own roles.
  // `encodeShareHash` without a base URL gives the bare `#s=…` hash.
  if (/^https?:\/\/\S+#s=/.test(trimmed) || /^#s=[\w-]+$/.test(trimmed)) return "link";
  if (trimmed.startsWith("<")) return "xml";
  // JSON must be checked before the CSV heuristic: a toJson() payload contains
  // both a comma and a "name" field, so the CSV check would misclassify it.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* fall through */
    }
  }
  if (isTenzing(trimmed)) return "tenzing";
  // CSV only with a "Name" header cell: a pasted "Anne Namer, Bob Smith" is names.
  if (headerCells(trimmed).includes("name")) return "csv";
  if (trimmed.length > 0) return "names";
  return "unknown";
}

/** What {@link importAny} read. `asks` and `selfId` come only from JSON, `title` only from a link. */
export interface Imported {
  format: Exclude<DetectedFormat, "unknown">;
  authors: Author[];
  asks?: Record<string, Ask>;
  selfId?: string;
  title?: string;
}

/**
 * Read text in any format {@link detectFormat} knows. Throws on text it cannot
 * place, on a link that does not decode, and whatever the format's own reader
 * throws (`NewerVersionError`, `ZodError`, an XML parse error). An empty
 * `authors` means the format was right but held nobody.
 */
export async function importAny(text: string, { parser }: { parser?: XmlParser } = {}): Promise<Imported> {
  const trimmed = text.trim();
  const format = detectFormat(trimmed);
  switch (format) {
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
    case "names":
      return { format, authors: parseAuthorText(trimmed) };
    default:
      throw new Error("Nothing to import.");
  }
}
