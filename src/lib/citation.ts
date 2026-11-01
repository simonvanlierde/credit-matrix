/** The CodeMeta fields a citation needs; codemeta.json is the source, kept in step with CITATION.cff by citesync. */
export interface CitationSource {
  name: string;
  version: string;
  datePublished: string;
  identifier: string;
  url: string;
  author: { givenName: string; familyName: string }[];
}

export const CITATION_FORMATS = {
  apa: { label: "APA", filename: "credit-matrix.txt", type: "text/plain" },
  bibtex: { label: "BibTeX", filename: "credit-matrix.bib", type: "application/x-bibtex" },
  csl: { label: "CSL-JSON", filename: "credit-matrix.csl.json", type: "application/vnd.citationstyles.csl+json" },
} as const;

export type CitationFormat = keyof typeof CITATION_FORMATS;

const TEX: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};
const tex = (text: string) => [...text].map((char) => TEX[char] ?? char).join("");

/**
 * The software citation in each format. BibTeX and CSL-JSON follow the shape citesync's playground
 * writes, so the two tools agree; APA 7 is the software reference style.
 */
export function citations(source: CitationSource): Record<CitationFormat, string> {
  const doi = source.identifier.replace(/^https:\/\/doi\.org\//, "");
  const [year, month, day] = source.datePublished.split("-").map(Number);
  const initials = (given: string) =>
    given
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((part) => `${part[0]}.`)
      .join(" ");
  const apaAuthors = source.author.map((a) => `${a.familyName}, ${initials(a.givenName)}`);
  const apaNames =
    apaAuthors.length > 1 ? `${apaAuthors.slice(0, -1).join(", ")}, & ${apaAuthors.at(-1)}` : (apaAuthors[0] ?? "");
  const bibFields = {
    title: `{${tex(source.name)}}`,
    author: source.author.map((a) => `{${tex(a.familyName)}}, {${tex(a.givenName)}}`).join(" and "),
    doi: tex(doi),
    url: tex(source.url),
    note: tex(`Software, version ${source.version}`),
    year: String(year),
  };
  const csl = {
    id: "credit-matrix",
    type: "software",
    title: source.name,
    author: source.author.map((a) => ({ family: a.familyName, given: a.givenName })),
    DOI: doi,
    URL: source.url,
    version: source.version,
    issued: { "date-parts": [[year, month, day]] },
  };
  return {
    apa: `${apaNames} (${year}). ${source.name} (Version ${source.version}) [Computer software]. ${source.identifier}`,
    bibtex: `@misc{credit-matrix,\n${Object.entries(bibFields)
      .map(([key, value]) => `  ${key} = {${value}},\n`)
      .join("")}}\n`,
    csl: `${JSON.stringify([csl], null, 2)}\n`,
  };
}
