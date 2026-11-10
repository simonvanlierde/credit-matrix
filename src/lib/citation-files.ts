import bibtex from "../../CITATION.bib?raw";
import apa from "../../citation.apa.txt?raw";
import csl from "../../citation.csl.json?raw";
import type { CitationFormat } from "./citation";

/** Committed citesync exports, included at build time. */
export const citations: Record<CitationFormat, string> = { apa, bibtex, csl };
