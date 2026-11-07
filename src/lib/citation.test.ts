// biome-ignore lint/correctness/noNodejsModules: compare bundled text with the committed release files.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import codemeta from "../../codemeta.json";
import { CITATION_FORMATS } from "./citation";
import { citations } from "./citation-files";

it("bundles the committed citesync citations without formatting them again", () => {
  for (const [format, path] of Object.entries({
    apa: "citation.apa.txt",
    bibtex: "CITATION.bib",
    csl: "citation.csl.json",
  })) {
    expect(citations[format as keyof typeof citations]).toBe(readFileSync(path, "utf8"));
  }
  expect(citations.apa).toContain(`(Version ${codemeta.version})`);
  expect(citations.bibtex).toMatch(/^@software\{/);
  expect(JSON.parse(citations.csl)[0]).toMatchObject({ type: "software", version: codemeta.version });
  expect(Object.keys(citations)).toEqual(Object.keys(CITATION_FORMATS));
});
