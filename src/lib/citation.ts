export const CITATION_FORMATS = {
  apa: { label: "APA", filename: "credit-matrix.txt", type: "text/plain" },
  bibtex: { label: "BibTeX", filename: "credit-matrix.bib", type: "application/x-bibtex" },
  csl: { label: "CSL-JSON", filename: "credit-matrix.csl.json", type: "application/vnd.citationstyles.csl+json" },
} as const;

export type CitationFormat = keyof typeof CITATION_FORMATS;
