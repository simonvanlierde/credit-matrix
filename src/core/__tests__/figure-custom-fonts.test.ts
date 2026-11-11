// biome-ignore-all lint/correctness/noNodejsModules: the font search reads font folders; Poppler checks the PDF.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import fontkit, { type Font } from "@pdf-lib/fontkit";
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIGURE_FONT_FILES } from "../figure-fonts";
import { createFigureRenderer, type FigureFace, FigureFontFileError, type FigureFontReport } from "../figures";
import { createAuthor } from "../parse-authors";

const FIXTURES = fileURLToPath(new URL("fixtures/fonts/", import.meta.url));
const POPPLER = spawnSync("pdffonts", ["-v"]).error === undefined;

const fonts = async (face: FigureFace) =>
  new Uint8Array(await readFile(new URL(`../../fonts/${FIGURE_FONT_FILES[face].file}`, import.meta.url)));

function renderer(reports: FigureFontReport[] = []) {
  return createFigureRenderer({ fonts, onFont: (report) => reports.push(report) });
}

const authors = (...names: string[]) =>
  names.map((name) => createAuthor(name, { contributions: [{ role: "Software", score: 100 }] }));

const options = (font: string, fontPath = [FIXTURES]) => ({
  font,
  fontPath,
  ignoreSystemFonts: true,
  acronyms: false,
  horizontal: true,
});

/** The fonts an SVG embeds, by family, and the text each family's tspans draw. */
function svgFonts(svg: string) {
  const embedded = new Map<string, { type: string; bytes: Uint8Array; font: Font }>();
  for (const [, family = "", type = "", data = ""] of svg.matchAll(
    /font-family:'([^']+)';src:url\('data:font\/(\w+);base64,([^']+)'\)/g,
  )) {
    const bytes = new Uint8Array(Buffer.from(data, "base64"));
    embedded.set(family, { type, bytes, font: fontkit.create(bytes) });
  }
  const drawn = new Map<string, string>();
  for (const [, family = "", text = ""] of svg.matchAll(/<tspan font-family="([^"]+)">([^<]*)<\/tspan>/g))
    drawn.set(family, (drawn.get(family) ?? "") + text);
  return { embedded, drawn };
}

/** The font files a PDF embeds, by base font name. */
async function pdfFonts(pdf: Uint8Array): Promise<Map<string, Font>> {
  const document = await PDFDocument.load(pdf);
  const found = new Map<string, Font>();
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of("Type"))?.toString() !== "/FontDescriptor") continue;
    const file = object.lookup(PDFName.of("FontFile2")) ?? object.lookup(PDFName.of("FontFile3"));
    if (!(file instanceof PDFRawStream)) continue;
    found.set(
      object.get(PDFName.of("FontName"))?.toString().slice(1) ?? "",
      fontkit.create(decodePDFRawStream(file).decode()),
    );
  }
  return found;
}

/** A font file's table tags. */
function tables(bytes: Uint8Array | undefined): string[] {
  const data = new DataView(bytes?.buffer ?? new ArrayBuffer(12), bytes?.byteOffset, bytes?.byteLength);
  return Array.from({ length: data.getUint16(4) }, (_, index) =>
    String.fromCharCode(...(bytes?.subarray(12 + index * 16, 16 + index * 16) ?? [])),
  );
}

/** Characters whose glyph in this font has no outline. */
function blank(font: Font, text: string): string {
  return [...new Set(text.replace(/\s/g, ""))]
    .filter((character) => !font.glyphForCodePoint(character.codePointAt(0) ?? 0).path.toSVG())
    .join("");
}

describe("figures in a font family the caller names", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("draws Latin in the family, names it in SVG and PDF, and reports its file", async () => {
    const reports: FigureFontReport[] = [];
    const figures = renderer(reports);
    // Family names match in any case; the figure uses the font's own spelling.
    const svg = await figures.svg(authors("Ada Lovelace"), options("figure test"));
    const { embedded, drawn } = svgFonts(svg);
    expect(drawn.get("Figure Test")).toContain("Ada Lovelace");
    expect(embedded.get("Figure Test")?.type).toBe("ttf");
    expect(svg).not.toContain("Noto Sans");
    expect(reports).toEqual([{ family: "Figure Test", file: join(FIXTURES, "FigureTest-Regular.ttf") }]);
    const pdf = await figures.pdf(authors("Ada Lovelace"), options("Figure Test"));
    expect([...(await pdfFonts(pdf)).keys()]).toEqual(["CMFIGR+FigureTest-Regular"]);
    // One search per renderer and family.
    expect(reports).toHaveLength(1);
    if (!POPPLER) return;
    expect(spawnSync("pdftotext", ["-", "-"], { input: pdf, encoding: "utf8" }).stdout).toContain("Ada Lovelace");
  });

  it("draws every glyph of a face with odd glyph offsets, which fontkit's subsetter truncated", async () => {
    const figures = renderer();
    const { embedded } = svgFonts(await figures.svg(authors("Ada Lovelace"), options("Figure Test")));
    const font = embedded.get("Figure Test")?.font;
    expect(font && blank(font, "Ada Lovelace Software")).toBe("");
    const pdf = await pdfFonts(await figures.pdf(authors("Ada Lovelace"), options("Figure Test")));
    const embeddedPdf = pdf.get("CMFIGR+FigureTest-Regular");
    expect(embeddedPdf && blank(embeddedPdf, "Ada Lovelace Software")).toBe("");
  });

  it("embeds a CFF .otf face as a valid OpenType font in SVG and PDF", async () => {
    const figures = renderer();
    const { embedded } = svgFonts(await figures.svg(authors("Ada Lovelace"), options("Figure Test CFF")));
    const face = embedded.get("Figure Test CFF");
    expect(face?.type).toBe("otf");
    expect(String.fromCharCode(...(face?.bytes.subarray(0, 4) ?? []))).toBe("OTTO");
    expect(tables(face?.bytes)).toEqual(
      expect.arrayContaining(["CFF ", "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post"]),
    );
    expect(face && blank(face.font, "Ada Lovelace")).toBe("");
    const pdf = await figures.pdf(authors("Ada Lovelace"), options("Figure Test CFF"));
    if (!POPPLER) return;
    const listed = spawnSync("pdffonts", ["-"], { input: pdf, encoding: "utf8" });
    expect(listed.stdout).toMatch(/CMFIGR\+FigureTestCFF-Regular\s+CID Type 0C \(OT\)/);
    expect(listed.stderr).toBe("");
  });

  it("refuses a CID-keyed CFF font whose CIDs are not its glyph ids in PDF, and draws it in SVG", async () => {
    const figures = renderer();
    expect(
      svgFonts(await figures.svg(authors("Ada 中文"), options("Figure Test CID"))).drawn.get("Figure Test CID"),
    ).toContain("Ada");
    await expect(figures.pdf(authors("Ada 中文"), options("Figure Test CID"))).rejects.toThrow(
      /CIDs differ from its glyph ids/,
    );
  });

  it("embeds a CID-keyed CFF font whose CIDs are its glyph ids in PDF", async () => {
    const pdf = await renderer().pdf(authors("ABBA"), options("Figure Test CID Identity"));
    expect([...(await pdfFonts(pdf)).keys()]).toContain("CMFIGR+FigureTestCIDIdentity-Regular");
  });

  it("picks the upright regular face of a collection", async () => {
    const reports: FigureFontReport[] = [];
    const pdf = await renderer(reports).pdf(authors("Ada Lovelace"), options("Figure Test Collection"));
    expect([...(await pdfFonts(pdf)).keys()]).toEqual(["CMFIGR+FigureTestCollection-Regular"]);
    expect(reports[0]?.file).toBe(join(FIXTURES, "FigureTestCollection.ttc"));
  });

  it("refuses a family installed only as WOFF2, naming the build to install", async () => {
    await expect(renderer().svg(authors("Ada"), options("Figure Test Web"))).rejects.toThrow(
      /FigureTestWeb-Regular\.woff2 is a web font \(WOFF\), which figures cannot embed\. Install the \.ttf or \.otf build of Figure Test Web\./,
    );
  });

  it("draws a variable font's default instance at weight 400 and refuses one whose default is 100", async () => {
    const figures = renderer();
    const { embedded } = svgFonts(await figures.svg(authors("Ada Lovelace"), options("Figure Test Variable")));
    // The default instance, with no variation tables left for a viewer to apply.
    expect(tables(embedded.get("Figure Test Variable")?.bytes)).not.toContain("fvar");
    await expect(figures.pdf(authors("Ada"), options("Figure Test Thin"))).rejects.toThrow(
      /FigureTestThin\.ttf is a variable font whose default instance is weight 100, not 400\. Install the static Regular build of Figure Test Thin/,
    );
  });

  it("warns about a restricted-license font and embeds it anyway", async () => {
    const reports: FigureFontReport[] = [];
    const figures = renderer(reports);
    const { embedded } = svgFonts(await figures.svg(authors("Ada"), options("Figure Test Restricted")));
    expect(embedded.has("Figure Test Restricted")).toBe(true);
    expect(reports[0]?.warning).toMatch(/allows only restricted license embedding \(OS\/2 fsType 0x0002\)/);
    // Without an onFont hook, the warning goes to the console, once.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const quiet = createFigureRenderer({ fonts });
    await quiet.svg(authors("Ada"), options("Figure Test Restricted"));
    await quiet.pdf(authors("Ada"), options("Figure Test Restricted"));
    expect(warn).toHaveBeenCalledOnce();
  });

  it("embeds a no-subsetting font whole", async () => {
    const whole = fontkit.create(readFileSync(join(FIXTURES, "FigureTestNoSubset-Regular.ttf")));
    const figures = renderer();
    const { embedded } = svgFonts(await figures.svg(authors("Ada"), options("Figure Test No Subset")));
    expect(embedded.get("Figure Test No Subset")?.font.numGlyphs).toBe(whole.numGlyphs);
    const pdf = await pdfFonts(await figures.pdf(authors("Ada"), options("Figure Test No Subset")));
    // No subset tag, by PDF convention.
    expect(pdf.get("FigureTestNoSubset-Regular")?.numGlyphs).toBe(whole.numGlyphs);
  });

  it("finds a family past an unreadable subfolder and a symlink loop in the font path", async () => {
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    try {
      mkdirSync(join(folder, "locked"));
      chmodSync(join(folder, "locked"), 0o000);
      symlinkSync(folder, join(folder, "loop"));
      mkdirSync(join(folder, "zz"));
      copyFileSync(join(FIXTURES, "FigureTest-Regular.ttf"), join(folder, "zz", "FigureTest-Regular.ttf"));
      const reports: FigureFontReport[] = [];
      await renderer(reports).svg(authors("Ada Lovelace"), options("Figure Test", [folder]));
      expect(reports.map(({ file }) => file)).toEqual([join(folder, "zz", "FigureTest-Regular.ttf")]);
    } finally {
      chmodSync(join(folder, "locked"), 0o700);
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("names a custom family apart from a built-in fallback face of the same name", async () => {
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    try {
      copyFileSync(fileURLToPath(new URL("../../fonts/NotoSans-Regular.ttf", import.meta.url)), join(folder, "a.ttf"));
      const svg = await renderer().svg(authors("Ada 中"), options("noto sans", [folder]));
      const families = [...svg.matchAll(/@font-face\{font-family:'([^']+)'/g)].map(([, family]) => family);
      expect(new Set(families).size).toBe(families.length);
      expect(families).toContain("Noto Sans (custom)");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("stops on a family it cannot find, never falling back", async () => {
    const figures = renderer();
    const missing = figures.pdf(authors("Ada"), options("No Such Family"));
    await expect(missing).rejects.toThrow(FigureFontFileError);
    await expect(missing).rejects.toThrow(
      `Cannot find the font family No Such Family in the font path (${FIXTURES}), with system fonts ignored.`,
    );
  });

  it("draws what the family lacks in the sans faces: Han in Credit Figure SC, ë in Noto Sans", async () => {
    const figures = renderer();
    const { drawn } = svgFonts(await figures.svg(authors("Zoë Chen 屠呦呦"), options("Figure Test")));
    expect(drawn.get("Figure Test")).toContain("Zo");
    expect(drawn.get("Noto Sans")).toBe("ë");
    expect(drawn.get("Credit Figure SC")).toBe("屠呦呦");
    const pdf = await pdfFonts(await figures.pdf(authors("Zoë Chen 屠呦呦"), options("Figure Test")));
    expect([...pdf.keys()].sort()).toEqual([
      "CMFIGR+CreditFigureSC-Regular",
      "CMFIGR+FigureTest-Regular",
      "CMFIGR+NotoSans-Regular",
    ]);
  });

  it("falls back to the serif faces for a serif family, unless fontFallback says sans", async () => {
    const figures = renderer();
    const names = authors("Zoë محمد");
    const serif = svgFonts(await figures.svg(names, options("Figure Test Serif"))).drawn;
    expect(serif.get("Noto Serif")).toBe("ë");
    expect(serif.get("Noto Naskh Arabic")).toBe("محمد");
    const sans = svgFonts(await figures.svg(names, { ...options("Figure Test Serif"), fontFallback: "sans" })).drawn;
    expect(sans.get("Noto Sans")).toBe("ë");
    expect(sans.get("Noto Sans Arabic")).toBe("محمد");
    // A sans family takes serif fallbacks on request.
    const forced = svgFonts(await figures.svg(names, { ...options("Figure Test"), fontFallback: "serif" })).drawn;
    expect(forced.get("Noto Serif")).toBe("ë");
    const pdf = await pdfFonts(await figures.pdf(names, options("Figure Test Serif")));
    expect([...pdf.keys()].sort()).toEqual([
      "CMFIGR+FigureTestSerif-Regular",
      "CMFIGR+NotoNaskhArabic-Regular",
      "CMFIGR+NotoSerif-Regular",
    ]);
  });

  describe.runIf(process.platform === "linux")("with system fonts", () => {
    /** A user font folder (XDG_DATA_HOME/fonts) holding a copy of the Figure Test face. */
    function userFonts(): string {
      const data = mkdtempSync(join(tmpdir(), "credit-matrix-fonts-"));
      mkdirSync(join(data, "fonts"));
      copyFileSync(join(FIXTURES, "FigureTest-Regular.ttf"), join(data, "fonts", "FigureTest-Regular.ttf"));
      vi.stubEnv("XDG_DATA_HOME", data);
      return data;
    }

    it("prefers a family in the font path over the same family installed on the system", async () => {
      const data = userFonts();
      try {
        const reports: FigureFontReport[] = [];
        await renderer(reports).svg(authors("Ada"), { ...options("Figure Test"), ignoreSystemFonts: false });
        expect(reports[0]?.file).toBe(join(FIXTURES, "FigureTest-Regular.ttf"));
      } finally {
        rmSync(data, { recursive: true });
      }
    });

    it("finds a system family unless system fonts are ignored", async () => {
      const data = userFonts();
      try {
        const reports: FigureFontReport[] = [];
        const system = { ...options("Figure Test", []), ignoreSystemFonts: false };
        await renderer(reports).svg(authors("Ada"), system);
        expect(reports[0]?.file).toBe(join(data, "fonts", "FigureTest-Regular.ttf"));
        await expect(renderer().svg(authors("Ada"), { ...system, ignoreSystemFonts: true })).rejects.toThrow(
          "Cannot find the font family Figure Test in no font path, with system fonts ignored.",
        );
      } finally {
        rmSync(data, { recursive: true });
      }
    });
  });
});
