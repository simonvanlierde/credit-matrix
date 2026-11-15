import { describe, expect, it } from "vitest";
import { fromCrossrefContributors } from "../export/crossref";
import { fromCsv } from "../export/csv";
import { escapeXml } from "../export/escape-xml";
import { heatmapPrintWarning } from "../export/heatmap-print";
import { toLatexCredits } from "../export/latex-credits";
import { fromTenzing } from "../export/tenzing";
import { fromJats4rXml } from "../export/xml-import";
import { detectFormat, importAny } from "../import";
import { createAuthor, parseAuthorText } from "../parse-authors";
import { decodeShareHash } from "../share-link";
import { parseStatement } from "../statement";

/**
 * Guards every parser against regexes that backtrack: each one reads a run of one repeated unit at two
 * sizes 8 times apart, and the larger must take less than 24 times as long. Linear work takes about 8
 * times as long, quadratic work about 64 times. Runs under 100 ms never fail, so timer noise on small
 * inputs does not.
 * Biome has no rule for super-linear regexes, so this test stands in for one.
 */
const UNITS = [" ", "\n", "\t", "/", "=", ":", ";", ",", ".", "-", "'", '"', "A", "é", "A.", "a.", "<svg ", "<text "];
const SMALL = 8_000;
const LARGE = 64_000;
const SLOWDOWN = 24;
const FLOOR_MS = 100;

const people = [{ given: "Marie", surname: "Curie" }];
const jats = (given: string, roleUrl: string) =>
  `<?xml version="1.0"?><article><front><article-meta><contrib-group><contrib contrib-type="author"><name><surname>Curie</surname><given-names>${escapeXml(given)}</given-names></name><role vocab-term-identifier="${escapeXml(roleUrl)}">Software</role></contrib></contrib-group></article-meta></front></article>`;
const crossref = (given: string) =>
  `<contributors><person_name sequence="first"><given_name>${escapeXml(given)}</given_name><surname>Curie</surname><role vocab="credit" type="software"/></person_name></contributors>`;

const TARGETS: [string, (text: string) => unknown][] = [
  ["importAny, raw text", (text) => importAny(text)],
  ["importAny, name list", (text) => importAny(`Marie Curie\n${text}`)],
  ["importAny, JSON", (text) => importAny(JSON.stringify({ version: 1, authors: [{ name: text }] }))],
  ["detectFormat", (text) => detectFormat(text)],
  ["fromCsv", (text) => fromCsv(`Name,Software\n${text},1`)],
  ["fromTenzing", (text) => fromTenzing(`Firstname,Surname,Software\n${text},Curie,TRUE`)],
  ["fromJats4rXml, name", (text) => fromJats4rXml(jats(text, ""))],
  ["fromJats4rXml, role URL", (text) => fromJats4rXml(jats("Marie", `https://credit.niso.org/${text}x`))],
  ["fromCrossrefContributors", (text) => fromCrossrefContributors(crossref(text))],
  ["decodeShareHash", (text) => decodeShareHash(`#s=${text}`)],
  ["parseStatement", (text) => parseStatement(text, people)],
  ["parseStatement, lead-in", (text) => parseStatement(`M.C.: methodology; ${text} software`, people)],
  ["parseAuthorText", (text) => parseAuthorText(text)],
  ["heatmapPrintWarning", (text) => heatmapPrintWarning(text)],
  // Names are capped at 500 characters, so this one runs the cap many times over.
  ["toLatexCredits", (text) => toLatexCredits(text.match(/[\s\S]{1,500}/g)?.map((n) => createAuthor(`A${n}`)) ?? [])],
];

async function ms(parse: (text: string) => unknown, text: string): Promise<number> {
  const start = performance.now();
  try {
    await parse(text);
  } catch {
    // Rejecting the input is fine; only the time counts.
  }
  return performance.now() - start;
}

describe("parsers on pathological input", () => {
  it.each(TARGETS)("%s grows linearly", { timeout: 120_000 }, async (_, parse) => {
    const slow: string[] = [];
    for (const unit of UNITS) {
      const repeat = (length: number) => unit.repeat(Math.ceil(length / unit.length));
      const small = await ms(parse, repeat(SMALL));
      const large = await ms(parse, repeat(LARGE));
      if (large > FLOOR_MS && large > SLOWDOWN * small)
        slow.push(`${JSON.stringify(unit)}: ${small.toFixed(0)} ms -> ${large.toFixed(0)} ms`);
    }
    expect(slow).toEqual([]);
  });
});
