import { describe, expect, it } from "vitest";
import { fromCrossrefContributors } from "../export/crossref";
import { fromCsv } from "../export/csv";
import { escapeXml } from "../export/escape-xml";
import { heatmapPrintWarning } from "../export/heatmap-print";
import { escapeLatex } from "../export/latex-credits";
import { fromTenzing } from "../export/tenzing";
import { fromJats4rXml } from "../export/xml-import";
import { detectFormat, importAny } from "../import";
import { parseAuthorText } from "../parse-authors";
import { decodeShareHash } from "../share-link";
import { parseStatement } from "../statement";

/**
 * Guards every parser against regexes that backtrack: each one reads a run of one repeated unit at two
 * sizes k times apart (8 or 32), and the larger must take less than 3k times as long. Linear work takes
 * about k times as long, quadratic work about k² times. Each size is timed best of 3 after a warm-up,
 * so one GC or CPU stall does not fail linear code, and runs under 500 ms never fail: with coverage under a
 * 50% CPU quota, linear runs reached about 200 ms, and every quadratic case found here took over 800 ms.
 * Biome has no rule for super-linear regexes, so this test stands in for one.
 */
const UNITS = [" ", "\n", "\t", "/", "=", ":", ";", ",", ".", "-", "'", '"', "A", "é", "A.", "a.", "<svg ", "<text "];
const SMALL = 8_000;
const RUNS = 3;
const SLOWDOWN = 3;
const FLOOR_MS = 500;

const people = [{ given: "Marie", surname: "Curie" }];
const jats = (given: string, roleUrl: string) =>
  `<?xml version="1.0"?><article><front><article-meta><contrib-group><contrib contrib-type="author"><name><surname>Curie</surname><given-names>${escapeXml(given)}</given-names></name><role vocab-term-identifier="${escapeXml(roleUrl)}">Software</role></contrib></contrib-group></article-meta></front></article>`;
const crossref = (given: string) =>
  `<contributors><person_name sequence="first"><given_name>${escapeXml(given)}</given_name><surname>Curie</surname><role vocab="credit" type="software"/></person_name></contributors>`;

// [name, parse, larger size]. The heatmap scans are cheap per character, so they need a longer run to
// cross the floor when quadratic.
const TARGETS: [string, (text: string) => unknown, number][] = [
  ["importAny, raw text", (text) => importAny(text), 64_000],
  ["importAny, name list", (text) => importAny(`Marie Curie\n${text}`), 64_000],
  ["detectFormat", (text) => detectFormat(text), 64_000],
  ["fromCsv", (text) => fromCsv(`Name,Software\n${text},1`), 64_000],
  ["fromTenzing", (text) => fromTenzing(`Firstname,Surname,Software\n${text},Curie,TRUE`), 64_000],
  ["fromJats4rXml, name", (text) => fromJats4rXml(jats(text, "")), 64_000],
  ["fromJats4rXml, role URL", (text) => fromJats4rXml(jats("Marie", `https://credit.niso.org/${text}x`)), 64_000],
  ["fromCrossrefContributors", (text) => fromCrossrefContributors(crossref(text)), 64_000],
  ["decodeShareHash", (text) => decodeShareHash(`#s=${text}`), 64_000],
  ["parseStatement", (text) => parseStatement(text, people), 64_000],
  ["parseStatement, lead-in", (text) => parseStatement(`M.C.: methodology; ${text} software`, people), 64_000],
  ["parseAuthorText", (text) => parseAuthorText(text), 64_000],
  ["heatmapPrintWarning, <svg tag", (text) => heatmapPrintWarning(text), 256_000],
  ["heatmapPrintWarning, <text tags", (text) => heatmapPrintWarning(`<svg width="1" height="1">${text}`), 256_000],
  // Names are capped at 500 characters, so only the escape itself sees a long run.
  ["escapeLatex", (text) => escapeLatex(text), 64_000],
];

/** Best of `RUNS` timings, in ms. Rejecting the input is fine; only the time counts. */
async function ms(parse: (text: string) => unknown, text: string): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    try {
      await parse(text);
    } catch {
      // A rejected input still counts its time.
    }
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("parsers on pathological input", () => {
  it.each(TARGETS)("%s grows linearly", { timeout: 300_000 }, async (_, parse, large) => {
    const slow: string[] = [];
    for (const unit of UNITS) {
      const repeat = (length: number) => unit.repeat(Math.ceil(length / unit.length));
      await ms(parse, repeat(SMALL)); // warm-up: the JIT compiles the path before it is timed
      const small = await ms(parse, repeat(SMALL));
      const big = await ms(parse, repeat(large));
      if (big > FLOOR_MS && big > SLOWDOWN * (large / SMALL) * small)
        slow.push(`${JSON.stringify(unit)}: ${small.toFixed(0)} ms -> ${big.toFixed(0)} ms`);
    }
    expect(slow).toEqual([]);
  });
});
