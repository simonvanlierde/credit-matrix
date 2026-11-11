// biome-ignore-all lint/correctness/noNodejsModules: Poppler independently checks the generated PDF.
import { execFileSync, spawnSync } from "node:child_process";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createFigureRenderer, type FigureFace } from "../figures";
import { createAuthor } from "../parse-authors";

const POPPLER = ["pdftotext", "pdffonts"].every((tool) => spawnSync(tool, ["-v"]).error === undefined);

/** The ActualText strings a PDF's content streams carry, decoded from UTF-16BE. */
async function actualTexts(pdf: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(pdf);
  return document.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream ? [Buffer.from(decodePDFRawStream(object).decode()).toString("latin1")] : [],
    )
    .flatMap((stream) => [...stream.matchAll(/\/ActualText <FEFF([0-9A-F]*)>/gi)])
    .map(([, hex]) =>
      Buffer.from(hex ?? "", "hex")
        .swap16()
        .toString("utf16le"),
    );
}

const NAMES = [
  { script: "Korean", name: "김민준", family: "Credit Figure KR", face: "sans-kr" },
  { script: "Thai", name: "สมชาย ใจดี", family: "Noto Sans Thai", face: "sans-thai" },
  { script: "Arabic", name: "محمد عبد الله", family: "Noto Sans Arabic", face: "sans-arabic" },
  { script: "Hebrew", name: "דוד בן־גוריון", family: "Noto Sans Hebrew", face: "sans-hebrew" },
  { script: "Hindi", name: "प्रियंका शर्मा", family: "Noto Sans Devanagari", face: "sans-devanagari" },
  { script: "Bengali", name: "রবীন্দ্রনাথ ঠাকুর", family: "Noto Sans Bengali", face: "sans-bengali" },
  { script: "emoji", name: "Ada 👍🏽", family: "Credit Figure Emoji", face: "emoji" },
] as const;

describe("figures in every covered script", () => {
  const asked = new Set<FigureFace>();
  const renderer = createFigureRenderer({
    fonts: async (face) => {
      asked.add(face);
      const { readFile } = await import("node:fs/promises");
      const { FIGURE_FONT_FILES } = await import("../figure-fonts");
      return new Uint8Array(await readFile(new URL(`../../fonts/${FIGURE_FONT_FILES[face].file}`, import.meta.url)));
    },
  });
  const options = { acronyms: false, horizontal: true };

  it.each(NAMES)("draws a $script name in its own face, in SVG and PDF", async ({ name, family }) => {
    const authors = [createAuthor(name, { contributions: [{ role: "Software", score: 100 }] })];
    const svg = await renderer.svg(authors, options);
    expect(svg).toContain(`font-family:'${family}'`);
    // No run falls back to the viewer's system fonts.
    expect(svg).not.toMatch(/<tspan font-family="[^"]*sans-serif">/);
    const pdf = await renderer.pdf(authors, options);
    // Copy and search see each shaped run's letters in logical order, whatever order its glyphs are drawn in.
    // Korean needs no shaping; "Ada " is a Latin run before the emoji.
    if (family !== "Credit Figure KR")
      expect(await actualTexts(pdf)).toEqual([name.replace("Ada ", "").normalize("NFC")]);
    if (!POPPLER) return;
    expect(execFileSync("pdffonts", ["-"], { input: pdf, encoding: "utf8" })).toContain(family.replaceAll(" ", ""));
    // Poppler reads a right-to-left ActualText backwards, against the PDF spec; MuPDF and Acrobat do not.
    if (!/[\u0590-\u08ff]/u.test(name))
      expect(
        execFileSync("pdftotext", ["-", "-"], { input: pdf, encoding: "utf8" }).normalize("NFC").replace(/\s+/g, " "),
      ).toContain(name.normalize("NFC").replace("Ada ", ""));
  });

  it.each([
    { name: "محمد عبد الله", serif: "Noto Naskh Arabic", sans: "Noto Sans Arabic" },
    { name: "प्रियंका शर्मा", serif: "Noto Serif Devanagari", sans: "Noto Sans Devanagari" },
    // Korean has no serif face, so serif figures keep the sans one.
    { name: "김민준", serif: "Credit Figure KR", sans: "Credit Figure KR" },
  ])(
    "draws $name in a serif figure in its serif face, and in a sans one in its sans face",
    async ({ name, serif, sans }) => {
      const authors = [createAuthor(name, { contributions: [{ role: "Software", score: 100 }] })];
      for (const [font, family] of [
        ["serif", serif],
        ["sans", sans],
      ] as const) {
        const figure = { ...options, font };
        expect(await renderer.svg(authors, figure)).toContain(`font-family:'${family}'`);
        if (!POPPLER) continue;
        const pdf = await renderer.pdf(authors, figure);
        const fonts = execFileSync("pdffonts", ["-"], { input: pdf, encoding: "utf8" });
        expect(fonts).toContain(family.replaceAll(" ", ""));
        if (font === "serif" && serif !== sans) expect(fonts).not.toContain(sans.replaceAll(" ", ""));
      }
    },
  );

  it("keeps an emoji between right-to-left words neutral, as browsers do", async () => {
    const authors = [createAuthor("محمد 😀 علي", { contributions: [{ role: "Software", score: 100 }] })];
    const pdf = await renderer.pdf(authors, options);
    if (!POPPLER) return;
    const words = [
      ...execFileSync("pdftotext", ["-bbox", "-", "-"], { input: pdf, encoding: "utf8" }).matchAll(
        /xMin="([\d.]+)"[^>]*>([^<]*)</g,
      ),
    ].map(([, x, word]) => ({ x: Number(x), word: word ?? "" }));
    const left = (letter: string) => words.find(({ word }) => word.includes(letter))?.x ?? Number.NaN;
    // The whole label reads right to left: علي is leftmost, محمد rightmost.
    expect(left("ل")).toBeLessThan(left("ح"));
  });

  it("keeps an emoji sequence in one emoji run, keycaps included", async () => {
    for (const sequence of ["👩\u200d🔬", "🇳🇱", "1\ufe0f\u20e3"]) {
      const svg = await renderer.svg(
        [createAuthor(`Ada ${sequence}`, { contributions: [{ role: "Software", score: 100 }] })],
        options,
      );
      expect(svg, sequence).toContain(`>${sequence}</tspan>`);
    }
  });

  it("draws text-default emoji and leaves a mark the face lacks to a face that has it", async () => {
    for (const name of ["Ada ❤️", "Ada ✌🏽", "علي\u0301", "Ada 1\ufe0f\u20e3"]) {
      const pdf = await renderer.pdf(
        [createAuthor(name, { contributions: [{ role: "Software", score: 100 }] })],
        options,
      );
      const document = await PDFDocument.load(pdf);
      const streams = document.context
        .enumerateIndirectObjects()
        .flatMap(([, object]) =>
          object instanceof PDFRawStream ? [Buffer.from(decodePDFRawStream(object).decode()).toString("latin1")] : [],
        );
      // No .notdef glyph drawn.
      expect(streams.join("\n"), name).not.toContain("<0000> Tj");
    }
  });

  it("loads no script face or shaping engine for a Latin figure", async () => {
    const latin = createFigureRenderer({
      fonts: async (face) => {
        if (face !== "sans") throw new Error(`Asked for ${face}.`);
        const { readFile } = await import("node:fs/promises");
        return new Uint8Array(await readFile(new URL("../../fonts/NotoSans-Regular.ttf", import.meta.url)));
      },
    });
    const authors = [createAuthor("Ada Lovelace", { contributions: [{ role: "Software", score: 100 }] })];
    await latin.svg(authors, options);
    await latin.pdf(authors, options);
  });

  it("orders a mixed label as SVG viewers do, left to right as the base", async () => {
    const authors = [createAuthor("محمد Smith", { contributions: [{ role: "Software", score: 100 }] })];
    const pdf = await renderer.pdf(authors, options);
    expect(await actualTexts(pdf)).toEqual(["محمد", " "]);
    if (!POPPLER) return;
    const words = [
      ...execFileSync("pdftotext", ["-bbox", "-", "-"], { input: pdf, encoding: "utf8" }).matchAll(
        /xMin="([\d.]+)"[^>]*>([^<]*)</g,
      ),
    ].map(([, x, word]) => ({ x: Number(x), word: word ?? "" }));
    const left = (pattern: RegExp) => words.find(({ word }) => pattern.test(word))?.x ?? Number.NaN;
    expect(left(/[\u0600-\u06ff]/)).toBeLessThan(left(/Smith/));
  });
});
