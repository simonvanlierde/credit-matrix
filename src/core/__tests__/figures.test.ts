// biome-ignore-all lint/correctness/noNodejsModules: Poppler independently checks the generated publication files.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import fontkit from "@pdf-lib/fontkit";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { AVAILABLE_LOCALES, loadRoleCatalog, makeRoleTranslator } from "../credit-i18n/index";
import { loadUiCatalog, makeUiTranslator } from "../credit-i18n/ui-strings";
import * as heatmap from "../export/heatmap-svg";
import { createFigureRenderer, FigureFontError } from "../figures";
import { createAuthor } from "../parse-authors";

const FONT_LOCALES = AVAILABLE_LOCALES.flatMap(({ code }) =>
  (["sans", "serif"] as const).map((font) => ({ code, font })),
);

const POPPLER = ["pdftoppm", "pdftotext", "pdffonts", "pdfimages"].every(
  (tool) => spawnSync(tool, ["-v"]).error === undefined,
);
const NO_POPPLER = "Poppler (pdftoppm, pdftotext, pdffonts, pdfimages) is not installed";

function embeddedFonts(svg: string) {
  return [...svg.matchAll(/font-family:'([^']+)';src:url\('data:font\/ttf;base64,([^']+)'\)/g)].map(
    ([, family, data]) => ({ family, font: fontkit.create(Buffer.from(data ?? "", "base64")) }),
  );
}

function team() {
  return ["Zoë & René <Smith>", "山田 太郎", "华罗庚"].map((name) => {
    const author = createAuthor(name);
    for (const contribution of author.contributions) contribution.score = 66;
    return author;
  });
}

describe("portable figures", () => {
  const renderer = createFigureRenderer();

  it("uses the embedded font's actual family name for editable SVG", async () => {
    const svg = await renderer.svg(team());
    expect(svg).toContain('font-family="Noto Sans"');
    expect(svg).not.toContain("Credit Figure Sans");
  });

  it.each([
    { locale: "ja", font: "sans" as const, names: ["山田 太郎", "鈴木 花子"] },
    { locale: "ja", font: "serif" as const, names: ["山田 太郎", "鈴木 花子"] },
    { locale: "zh-Hans", font: "sans" as const, names: ["华罗庚", "张伟"] },
    { locale: "zh-Hans", font: "serif" as const, names: ["华罗庚", "张伟"] },
  ])("embeds only the $font $locale glyphs a figure uses in SVG", async ({ locale, font, names }) => {
    const authors = names.map((name) => createAuthor(name, { contributions: [{ role: "Software", score: 100 }] }));
    const svg = await renderer.svg(authors, {
      locale,
      font,
      acronyms: false,
      translateRole: makeRoleTranslator(await loadRoleCatalog(locale)),
      translateUi: makeUiTranslator(await loadUiCatalog(locale)),
    });
    // Whole CJK faces are 6-15 MB; the glyphs of one figure fit in a few hundred kB.
    expect(svg.length).toBeLessThan(300_000);
    const fonts = embeddedFonts(svg);
    expect(fonts.length).toBeGreaterThan(0);
    for (const [, family, text] of svg.matchAll(/<tspan font-family="([^"]+)">([^<]*)<\/tspan>/g)) {
      const embedded = fonts.find((candidate) => candidate.family === family)?.font;
      for (const character of text?.replace(/&[a-z]+;/g, "") ?? "")
        expect(embedded?.hasGlyphForCodePoint(character.codePointAt(0) ?? 0), `${family} ${character}`).toBe(true);
    }
    for (const { font: embedded } of fonts) expect(embedded.numGlyphs).toBeLessThan(200);
  });

  it.each([
    { locale: "en", name: "张伟", family: "Credit Figure SC" },
    { locale: "de", name: "湯川秀樹", family: "Credit Figure SC" },
    { locale: "ja", name: "湯川秀樹", family: "Credit Figure JP" },
    { locale: "en", name: "やまだ山田", family: "Credit Figure JP" },
  ])("draws $name with $family under $locale", async ({ locale, name, family }) => {
    const author = createAuthor(name, { contributions: [{ role: "Software", score: 100 }] });
    expect(await renderer.svg([author], { locale, acronyms: false })).toContain(
      `<tspan font-family="${family}">${name}</tspan>`,
    );
  });

  it("takes punctuation beside Chinese text from the Chinese face under zh", async () => {
    const author = createAuthor("“张伟”", { contributions: [{ role: "Software", score: 100 }] });
    expect(await renderer.svg([author], { locale: "zh-Hans", acronyms: false })).toContain(
      '<tspan font-family="Credit Figure SC">“张伟”</tspan>',
    );
    expect(await renderer.svg([author], { locale: "en", acronyms: false })).toContain(
      '<tspan font-family="Noto Sans">“</tspan><tspan font-family="Credit Figure SC">张伟</tspan>',
    );
  });

  it("loads only the faces a figure's text needs", async () => {
    const create = vi.spyOn(fontkit, "create");
    try {
      const fresh = createFigureRenderer();
      await fresh.svg([createAuthor("Grace Hopper", { contributions: [{ role: "Software", score: 100 }] })]);
      expect(create).toHaveBeenCalledTimes(1);
      await fresh.svg([createAuthor("张伟", { contributions: [{ role: "Software", score: 100 }] })], {
        acronyms: false,
      });
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      create.mockRestore();
    }
  });

  it("writes byte-identical PDFs with fixed metadata", async () => {
    const first = await renderer.pdf(team(), { locale: "ja" });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await renderer.pdf(team(), { locale: "ja" });
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    const document = await PDFDocument.load(first, { updateMetadata: false });
    expect(document.getProducer()).toBe("CRediT Matrix");
    expect(document.getCreationDate()).toBeUndefined();
    expect(document.getModificationDate()).toBeUndefined();
  });

  it("retains XML-like title and description text in PDF metadata", async () => {
    const title = "<title>a\n".repeat(40);
    const name = `${"-".repeat(100)}${"<desc>a".repeat(40)}`;
    const author = createAuthor(name);
    for (const contribution of author.contributions) contribution.score = 100;
    const translateUi = makeUiTranslator(null);
    const bytes = await renderer.pdf([author], {
      translateUi: (key) => (key === "heatmapTitle" ? title : translateUi(key)),
    });
    const document = await PDFDocument.load(bytes);
    expect(document.getTitle()).toBe(title);
    expect(document.getSubject()).toContain(name);
  });

  it("honors serif output in embedded SVG and PDF fonts", async ({ skip }) => {
    const svg = await renderer.svg(team(), { font: "serif", locale: "ja", acronyms: false });
    expect(svg.includes('font-family="Noto Serif"')).toBe(true);
    expect(svg.includes('font-family="Credit Figure Serif JP"')).toBe(true);
    expect(svg.includes('font-family="Noto Sans"')).toBe(false);
    const bytes = await renderer.pdf(team(), { font: "serif", locale: "ja", acronyms: false });
    skip(!POPPLER, NO_POPPLER);
    const fonts = execFileSync("pdffonts", ["-"], { input: bytes, encoding: "utf8" });
    expect(fonts).toMatch(/NotoSerif/);
    expect(fonts).toMatch(/CreditFigureSerifJP/);
  });

  it("rejects unsupported vector primitives instead of dropping them", async () => {
    const source = vi
      .spyOn(heatmap, "buildHeatmapSvg")
      .mockReturnValue('<svg width="100" height="100"><ellipse/></svg>');
    try {
      await expect(renderer.pdf([])).rejects.toThrow("Unsupported figure primitive: ellipse.");
    } finally {
      source.mockRestore();
    }
  });

  it("uses a requested PDF print width and rejects invalid physical sizes", async () => {
    const pdf = await PDFDocument.load(await renderer.pdf(team(), undefined, 85));
    expect(pdf.getPages()[0]?.getWidth()).toBeCloseTo((85 * 72) / 25.4);
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      await expect(renderer.pdf(team(), undefined, width)).rejects.toThrow(/width/i);
  });

  it.each([
    { font: "sans" as const, names: ["É".repeat(20), "W".repeat(20)], emHeight: 1.362 },
    { font: "serif" as const, names: ["É".repeat(20), "W".repeat(20)], emHeight: 1.362 },
    { font: "sans" as const, names: ["山田".repeat(10), "华罗庚".repeat(8)], emHeight: 1.2 },
    { font: "serif" as const, names: ["山田".repeat(10), "华罗庚".repeat(8)], emHeight: 1.437 },
  ])("separates large $font labels using their font height ($emHeight em)", async ({ font, names, emHeight }) => {
    const authors = names.map((name) => createAuthor(name, { contributions: [{ role: "Software", score: 100 }] }));
    const options = { font, fontSize: 32, size: 8, acronyms: false };
    const top = [
      ...(await renderer.svg(authors, options)).matchAll(
        /<text transform="translate\(([\d.]+),[\d.]+\) rotate\(-45\)"/g,
      ),
    ];
    const perpendicular = (Number(top[1]?.[1]) - Number(top[0]?.[1])) / Math.SQRT2;
    expect(perpendicular).toBeGreaterThan(Math.ceil((32 * 11 * emHeight) / 10.5));
    const rows = [
      ...(await renderer.svg(authors, { ...options, horizontal: true })).matchAll(
        /<text x="[\d.]+" y="([\d.]+)" text-anchor="end"/g,
      ),
    ];
    expect(Number(rows[1]?.[1]) - Number(rows[0]?.[1])).toBeGreaterThan(Math.ceil(32 * emHeight));
  });

  it.for([true, false])("retains visible publication marks in PDF when levels=%s", async (levels, { skip }) => {
    const authors = [createAuthor("Grace Hopper", { contributions: [{ role: "Software", score: 100 }] })];
    const options = { levels, legendPosition: "right" as const };
    const svg = await renderer.svg(authors, { ...options, marks: true });
    const cell = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="22" height="22"/);
    if (!cell) throw new Error("Expected one 22px heatmap cell");
    const sampleX = Number(cell[1]) + (levels ? 11 : 22 * 0.5);
    const sampleY = Number(cell[2]) + (levels ? 11 : 22 * 0.58);
    const grayAtMark = async (marks: boolean) => {
      const bytes = await renderer.pdf(authors, { ...options, marks });
      const image = execFileSync("pdftoppm", ["-singlefile", "-r", "96", "-gray", "-"], { input: bytes });
      const header = image
        .subarray(0, 100)
        .toString("ascii")
        .match(/^P5\n(\d+) (\d+)\n255\n/);
      if (!header) throw new Error("Expected a grayscale image");
      const width = Number(header[1]);
      return image[header[0].length + Math.round(sampleY) * width + Math.round(sampleX)] ?? 0;
    };
    skip(!POPPLER, NO_POPPLER);
    expect(await grayAtMark(true)).toBeGreaterThan((await grayAtMark(false)) + 80);
    if (!levels) {
      const document = await PDFDocument.load(await renderer.pdf(authors, { ...options, marks: true }));
      const contents = document.context
        .enumerateIndirectObjects()
        .flatMap(([, object]) =>
          object instanceof PDFRawStream ? [Buffer.from(decodePDFRawStream(object).decode()).toString("latin1")] : [],
        )
        .join("\n");
      expect(contents).toContain("1 J");
      expect(contents).toContain("1 j");
    }
  });

  it.each(FONT_LOCALES)(
    "embeds standalone fonts and retains readable text in $font $code SVG",
    async ({ code, font }) => {
      const svg = await renderer.svg(team(), {
        locale: code,
        font,
        acronyms: false,
        translateRole: makeRoleTranslator(await loadRoleCatalog(code)),
        translateUi: makeUiTranslator(await loadUiCatalog(code)),
      });
      expect(svg).toMatch(/@font-face/);
      expect(svg).toMatch(/data:font\/(?:ttf|otf);base64,/);
      expect(svg).toContain("山田 太郎");
      expect(svg).toContain("华罗庚");
      expect(svg).toContain("Zoë &amp; René &lt;Smith&gt;");
      expect(svg).not.toContain("Helvetica");
      expect(svg).not.toMatch(/<image|<path/);
      expect(svg).toContain(
        `font-family="Credit Figure ${font === "serif" ? "Serif " : ""}${code === "ja" ? "JP" : "SC"}"`,
      );
    },
  );

  it("normalizes decomposed accents and rejects missing glyphs explicitly", async () => {
    const author = createAuthor("Rene\u0301");
    for (const contribution of author.contributions) contribution.score = 100;
    expect(await renderer.svg([author], { acronyms: false })).toContain(">René<");
    const missing = createAuthor("Researcher \u{1F9EA}");
    for (const contribution of missing.contributions) contribution.score = 100;
    await expect(renderer.svg([missing], { acronyms: false })).rejects.toThrow(FigureFontError);
    await expect(renderer.svg([missing], { acronyms: false })).rejects.toThrow(/U\+1F9EA/);
    await expect(renderer.pdf([missing], { acronyms: false })).rejects.toThrow(FigureFontError);
  });

  it("draws characters outside the bundled faces in system fonts only when asked", async () => {
    const author = createAuthor("김민준");
    for (const contribution of author.contributions) contribution.score = 100;
    const latin = createAuthor("René");
    for (const contribution of latin.contributions) contribution.score = 100;
    await expect(renderer.svg([author, latin])).rejects.toThrow(FigureFontError);
    const svg = await renderer.svg([author, latin], { fallback: "system" });
    expect(svg).toContain(`<tspan font-family="'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif">김민준</tspan>`);
    expect(svg).toContain('<tspan font-family="Noto Sans">R</tspan>');
    expect(embeddedFonts(svg).map(({ family }) => family)).toEqual(["Noto Sans"]);
    const serif = await renderer.svg([author], { fallback: "system", font: "serif" });
    expect(serif).toContain(`<tspan font-family="Georgia, 'Times New Roman', serif">김민준</tspan>`);
    await expect(renderer.pdf([author], { fallback: "system" } as never)).rejects.toThrow(FigureFontError);
  });

  it("positions an uncomposed Latin accent using its font's mark offsets", async ({ skip }) => {
    const author = createAuthor("q\u0301");
    for (const contribution of author.contributions) contribution.score = 100;
    const bytes = await renderer.pdf([author], { acronyms: false, horizontal: true });
    const document = await PDFDocument.load(bytes);
    skip(!POPPLER, NO_POPPLER);
    expect(execFileSync("pdftotext", ["-raw", "-", "-"], { input: bytes, encoding: "utf8" })).toContain("q\u0301");
    const streams = document.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream ? [Buffer.from(decodePDFRawStream(object).decode()).toString("latin1")] : [],
      );
    const cmap = streams.find((stream) => stream.includes("beginbfchar")) ?? "";
    const q = cmap.match(/<([A-Fa-f0-9]{4})> <0071>/)?.[1];
    const acute = cmap.match(/<([A-Fa-f0-9]{4})> <0301>/)?.[1];
    expect(q).toBeDefined();
    expect(acute).toBeDefined();
    const content = streams.find((stream) => stream.includes(" Tj")) ?? "";
    const qMatrix = content.match(new RegExp(`([-.\\d]+) ([-.\\d]+) Tm\\n<${q}> Tj`));
    const acuteMatrix = content.match(new RegExp(`([-.\\d]+) ([-.\\d]+) Tm\\n<${acute}> Tj`));
    expect(qMatrix).not.toBeNull();
    expect(acuteMatrix).not.toBeNull();
    // The bundled face's q advances 615 units; its acute attaches 35 units back at 10.5px/1000 units.
    expect(Number(acuteMatrix?.[1]) - Number(qMatrix?.[1])).toBeCloseTo((615 - 35) * 0.0105, 5);
  });

  it.for(["山田太郎", "华罗庚", "𠮷野"])(
    "renders ink for every glyph of %s without installed fonts",
    async (name, { skip }) => {
      const author = createAuthor(name);
      for (const contribution of author.contributions) if (contribution.role === "Software") contribution.score = 100;
      const options = { acronyms: false, horizontal: true, legend: false };
      const svg = await renderer.svg([author], options);
      // A name can span faces: 𠮷 is only in the Japanese face.
      const label = svg
        .match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>((?:<tspan[^>]*>[^<]*<\/tspan>)+)<\/text>/g)
        ?.map((text) => text.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(.*)<\/text>/))
        .find((match) => [...(match?.[3] ?? "").matchAll(/>([^<]*)</g)].map(([, run]) => run).join("") === name);
      expect(label).toBeDefined();
      skip(!POPPLER, NO_POPPLER);
      const directory = mkdtempSync(join(tmpdir(), "credit-glyph-ink-"));
      try {
        const pdf = join(directory, "figure.pdf");
        const proof = join(directory, "proof");
        const fontDirectory = join(directory, "empty-fonts");
        const fontCache = join(directory, "font-cache");
        const fontConfig = join(directory, "fonts.conf");
        mkdirSync(fontDirectory);
        mkdirSync(fontCache);
        writeFileSync(
          fontConfig,
          `<fontconfig><dir>${fontDirectory}</dir><cachedir>${fontCache}</cachedir></fontconfig>`,
        );
        writeFileSync(pdf, await renderer.pdf([author], options));
        // At 96 dpi the PDF's points map back to the source SVG's pixel coordinates.
        execFileSync("pdftoppm", ["-singlefile", "-r", "96", "-gray", pdf, proof], {
          env: { ...process.env, FONTCONFIG_FILE: fontConfig },
        });
        const pixels = readFileSync(`${proof}.pgm`);
        const header = pixels
          .subarray(0, 100)
          .toString("ascii")
          .match(/^P5\n(\d+) (\d+)\n255\n/);
        if (!header) throw new Error("Expected a binary grayscale Poppler image");
        const imageWidth = Number(header[1]);
        const baseline = Number(label?.[2]);
        const startX = Number(label?.[1]) - [...name].length * 10.5;
        for (const [index] of [...name].entries()) {
          let ink = 0;
          for (let y = Math.floor(baseline - 10.5); y < Math.ceil(baseline + 2); y++) {
            for (let x = Math.floor(startX + index * 10.5); x < Math.floor(startX + (index + 1) * 10.5); x++) {
              if ((pixels[header[0].length + y * imageWidth + x] ?? 255) < 180) ink++;
            }
          }
          expect(ink, `visible glyph ${[...name][index]}`).toBeGreaterThan(5);
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.for(["square", "rounded", "circle"] as const)(
    "exports %s cells with embedded fonts and selectable CJK text",
    async (shape, { skip }) => {
      const bytes = await renderer.pdf(team(), { acronyms: false, shape, horizontal: true, locale: "ja" });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      const svg = await renderer.svg(team(), { acronyms: false, shape, horizontal: true, locale: "ja" });
      expect(doc.getPages()[0]?.getWidth()).toBeCloseTo(Number(svg.match(/width="([\d.]+)"/)?.[1]) * 0.75);
      expect(doc.getPages()[0]?.getHeight()).toBeCloseTo(Number(svg.match(/height="([\d.]+)"/)?.[1]) * 0.75);
      skip(!POPPLER, NO_POPPLER);
      const directory = mkdtempSync(join(tmpdir(), "credit-figure-"));
      try {
        const pdf = join(directory, "figure.pdf");
        writeFileSync(pdf, bytes);
        const fonts = execFileSync("pdffonts", [pdf], { encoding: "utf8" });
        const rows = fonts.trim().split("\n").slice(2);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(row).toMatch(/yes\s+yes\s+yes\s+\d+\s+\d+$/);
        const text = execFileSync("pdftotext", ["-raw", pdf, "-"], { encoding: "utf8" });
        expect(text).toContain("Zoë & René <Smith>");
        expect(text).toContain("山田 太郎");
        expect(text).toContain("华罗庚");
        expect(text.replace(/\s/g, "")).toContain("Conceptualization");
        expect(execFileSync("pdfimages", ["-list", pdf], { encoding: "utf8" }).trim().split("\n")).toHaveLength(2);
        expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  it.for(FONT_LOCALES)("retains the $font $code catalog's Unicode text in PDF", async ({ code, font }, { skip }) => {
    const translateRole = makeRoleTranslator(await loadRoleCatalog(code));
    const bytes = await renderer.pdf(team(), {
      locale: code,
      font,
      acronyms: false,
      translateRole,
      translateUi: makeUiTranslator(await loadUiCatalog(code)),
    });
    skip(!POPPLER, NO_POPPLER);
    const directory = mkdtempSync(join(tmpdir(), "credit-figure-locale-"));
    try {
      const pdf = join(directory, "figure.pdf");
      writeFileSync(pdf, bytes);
      const text = execFileSync("pdftotext", ["-raw", pdf, "-"], { encoding: "utf8" }).replace(/\s/g, "");
      expect(text).toContain(translateRole("Conceptualization").replace(/\s/g, ""));
      for (const author of team()) expect(text).toContain(author.name.replace(/\s/g, ""));
      const rasterized = spawnSync(
        "pdftoppm",
        ["-singlefile", "-scale-to", "600", "-png", pdf, join(directory, "proof")],
        {
          encoding: "utf8",
        },
      );
      expect(rasterized.status).toBe(0);
      expect(rasterized.stderr).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
