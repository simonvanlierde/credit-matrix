// biome-ignore-all lint/correctness/noNodejsModules: the font search reads font folders; Poppler checks the PDF.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { open, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
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
  for (const [, family = "", text = ""] of svg.matchAll(/<tspan font-family="'([^"]+)'">([^<]*)<\/tspan>/g))
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
    expect([...(await pdfFonts(pdf)).keys()]).toEqual(["CMCUST+FigureTest-Regular"]);
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
    const embeddedPdf = pdf.get("CMCUST+FigureTest-Regular");
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
    expect(listed.stdout).toMatch(/CMCUST\+FigureTestCFF-Regular\s+CID Type 0C \(OT\)/);
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
    expect([...(await pdfFonts(pdf)).keys()]).toContain("CMCUST+FigureTestCIDIdentity-Regular");
  });

  it("refuses a CFF2 font in PDF with its own reason", async () => {
    await expect(renderer().pdf(authors("Ada Lovelace"), options("Figure Test CFF2"))).rejects.toThrow(
      /Figure Test CFF2 is a CFF2 \(variable OpenType\) font/,
    );
  });

  it("refuses the fontFallback renderer option that fonts replaced", () => {
    expect(() => createFigureRenderer({ fontFallback: "https://example.org/fonts/" } as never)).toThrow(
      /takes fonts instead of fontFallback/,
    );
  });

  it("picks the upright regular face of a collection", async () => {
    const reports: FigureFontReport[] = [];
    const pdf = await renderer(reports).pdf(authors("Ada Lovelace"), options("Figure Test Collection"));
    expect([...(await pdfFonts(pdf)).keys()]).toEqual(["CMCUST+FigureTestCollection-Regular"]);
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

  // Root and Windows ignore mode 000, so the subfolder would stay readable and the test prove nothing.
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "finds a family past an unreadable subfolder and a symlink loop in the font path",
    async () => {
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
    },
  );

  it("prefers the first font path even when a later folder has a closer weight", async () => {
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    try {
      const medium = readFileSync(join(FIXTURES, "FigureTest-Regular.ttf"));
      const os2 = tables(medium).indexOf("OS/2");
      expect(os2).toBeGreaterThanOrEqual(0);
      medium.writeUInt16BE(500, medium.readUInt32BE(12 + os2 * 16 + 8) + 4);
      const first = join(folder, "medium.ttf");
      writeFileSync(first, medium);
      const reports: FigureFontReport[] = [];
      await renderer(reports).svg(authors("Ada"), options("Figure Test", [folder, FIXTURES]));
      expect(reports[0]?.file).toBe(first);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("picks weights in CSS Fonts 4 order for 400: 401-500 up, then lighter down, then bolder up", async () => {
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    try {
      const regular = readFileSync(join(FIXTURES, "FigureTest-Regular.ttf"));
      const weightAt = regular.readUInt32BE(12 + tables(regular).indexOf("OS/2") * 16 + 8) + 4;
      for (const weight of [900, 600, 100, 300, 500, 450, 400]) {
        regular.writeUInt16BE(weight, weightAt);
        writeFileSync(join(folder, `${weight}.ttf`), regular);
      }
      const picked: string[] = [];
      for (let left = 7; left > 0; left--) {
        const reports: FigureFontReport[] = [];
        await renderer(reports).svg(authors("Ada"), options("Figure Test", [folder]));
        const file = reports[0]?.file ?? "";
        picked.push(file.slice(folder.length + 1));
        rmSync(file);
      }
      expect(picked).toEqual(["400.ttf", "450.ttf", "500.ttf", "300.ttf", "100.ttf", "600.ttf", "900.ttf"]);
    } finally {
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
      // Quoted: unquoted, the parentheses make the CSS value invalid and a browser draws its default font.
      expect(svg).toContain(`<tspan font-family="'Noto Sans (custom)'">Ada </tspan>`);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("tags a custom family's PDF subset apart from a built-in face with the same PostScript name", async () => {
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    try {
      const thai = fileURLToPath(new URL("../../fonts/NotoSansThai-Regular.ttf", import.meta.url));
      copyFileSync(thai, join(folder, "a.ttf"));
      // Thai is shaped, so the built-in face draws it; the custom copy draws the Latin.
      const pdf = await renderer().pdf(authors("Ada สมชาย"), options("noto sans thai", [folder]));
      const document = await PDFDocument.load(pdf);
      const names = document.context
        .enumerateIndirectObjects()
        .map(([, object]) => object)
        .filter((object) => object instanceof PDFDict && object.get(PDFName.of("Subtype"))?.toString() === "/Type0")
        .map((object) => (object as PDFDict).get(PDFName.of("BaseFont"))?.toString())
        .filter((name) => name?.includes("NotoSansThai"));
      expect(names.sort()).toEqual(["/CMCUST+NotoSansThai-Regular", "/CMFIGR+NotoSansThai-Regular"]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("draws Hangul in a custom family that has it, not in Credit Figure KR", async () => {
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    try {
      copyFileSync(fileURLToPath(new URL("../../fonts/CreditFigureKR.ttf", import.meta.url)), join(folder, "a.ttf"));
      const { drawn } = svgFonts(await renderer().svg(authors("Ada 김연아"), options("credit figure kr", [folder])));
      expect(drawn.get("Credit Figure KR (custom)")).toContain("김연아");
      expect(drawn.has("Credit Figure KR")).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("skips a collection whose header claims more faces than the file holds, reading only its bytes", async () => {
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    const header = new DataView(new ArrayBuffer(16));
    header.setUint32(0, 0x74746366); // "ttcf"
    header.setUint32(8, 2 ** 28);
    writeFileSync(join(folder, "a.ttc"), new Uint8Array(header.buffer));
    copyFileSync(join(FIXTURES, "FigureTest-Regular.ttf"), join(folder, "b.ttf"));
    const handle = await open(join(folder, "b.ttf"));
    const read = vi.spyOn(Object.getPrototypeOf(handle), "read");
    await handle.close();
    try {
      const svg = await renderer().svg(authors("Ada"), options("Figure Test", [folder]));
      expect(svgFonts(svg).drawn.get("Figure Test")).toContain("Ada");
      // A 2^28-face header once allocated a 1 GiB buffer to read the face list.
      const lengths = read.mock.calls.map((call) => Number(call[2] ?? 0));
      expect(Math.max(...lengths)).toBeLessThan(2 ** 20);
    } finally {
      read.mockRestore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("skips a face whose table directory claims a table longer than the file", async () => {
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    const forged = readFileSync(join(FIXTURES, "FigureTest-Regular.ttf"));
    forged.writeUInt32BE(0xfffffff0, 12 + tables(forged).indexOf("name") * 16 + 12);
    writeFileSync(join(folder, "a.ttf"), forged);
    copyFileSync(join(FIXTURES, "FigureTest-Regular.ttf"), join(folder, "b.ttf"));
    const handle = await open(join(folder, "b.ttf"));
    const read = vi.spyOn(Object.getPrototypeOf(handle), "read");
    await handle.close();
    try {
      const reports: FigureFontReport[] = [];
      await renderer(reports).svg(authors("Ada"), options("Figure Test", [folder]));
      expect(reports[0]?.file).toBe(join(folder, "b.ttf"));
      const lengths = read.mock.calls.map((call) => Number(call[2] ?? 0));
      expect(Math.max(...lengths)).toBeLessThan(2 ** 20);
    } finally {
      read.mockRestore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("stops reading a WOFF2 file whose Brotli stream expands past 64 MiB", async () => {
    // A name table naming the family, placed after 64 MiB of zeros in a stream that compresses to ~12 kB.
    const family = Buffer.from("Figure Test Bomb", "utf16le").swap16();
    const name = Buffer.alloc(18 + family.length);
    name.writeUInt16BE(1, 2);
    name.writeUInt16BE(18, 4);
    [3, 1, 0x409, 1, family.length, 0].forEach((value, index) => {
      name.writeUInt16BE(value, 6 + index * 2);
    });
    family.copy(name, 18);
    const padding = 2 ** 26;
    const stream = brotliCompressSync(Buffer.concat([Buffer.alloc(padding), name]), {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 },
    });
    // Directory: a 64 MiB head table (known index 1), then name (known index 5), lengths in UIntBase128.
    const directory = Buffer.from([1, 0xa0, 0x80, 0x80, 0x00, 5, name.length]);
    const header = Buffer.alloc(48);
    header.write("wOF2", 0, "latin1");
    header.write("true", 4, "latin1");
    header.writeUInt16BE(2, 12);
    header.writeUInt32BE(stream.length, 20);
    const folder = mkdtempSync(join(tmpdir(), "credit-matrix-font-path-"));
    writeFileSync(join(folder, "FigureTestBomb-Regular.woff2"), Buffer.concat([header, directory, stream]));
    try {
      await expect(renderer().svg(authors("Ada"), options("Figure Test Bomb", [folder]))).rejects.toThrow(
        `Cannot find the font family Figure Test Bomb in the font path (${folder}), with system fonts ignored.`,
      );
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
      "CMCUST+FigureTest-Regular",
      "CMFIGR+CreditFigureSC-Regular",
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
      "CMCUST+FigureTestSerif-Regular",
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
    }, 30_000);

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
    }, 30_000);
  });
});
