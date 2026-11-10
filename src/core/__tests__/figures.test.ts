// biome-ignore-all lint/correctness/noNodejsModules: Poppler independently checks the generated publication files.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { AVAILABLE_LOCALES, loadRoleCatalog, makeRoleTranslator } from "../credit-i18n/index";
import { loadUiCatalog, makeUiTranslator } from "../credit-i18n/ui-strings";
import { createFigureRenderer, FigureFontError } from "../figures";
import { createAuthor } from "../parse-authors";

function team() {
  return ["Zoë & René <Smith>", "山田 太郎", "屠呦呦"].map((name) => {
    const author = createAuthor(name);
    for (const contribution of author.contributions) contribution.score = 66;
    return author;
  });
}

describe("portable figures", () => {
  let renderer: Awaited<ReturnType<typeof createFigureRenderer>>;
  beforeAll(async () => {
    renderer = await createFigureRenderer();
  });

  it.each(AVAILABLE_LOCALES)("embeds standalone fonts and retains readable text in $code SVG", async ({ code }) => {
    const svg = renderer.svg(team(), {
      locale: code,
      acronyms: false,
      translateRole: makeRoleTranslator(await loadRoleCatalog(code)),
      translateUi: makeUiTranslator(await loadUiCatalog(code)),
    });
    expect(svg).toMatch(/@font-face/);
    expect(svg).toMatch(/data:font\/(?:ttf|otf);base64,/);
    expect(svg).toContain("山田 太郎");
    expect(svg).toContain("屠呦呦");
    expect(svg).toContain("Zoë &amp; René &lt;Smith&gt;");
    expect(svg).not.toContain("Helvetica");
    expect(svg).not.toMatch(/<image|<path/);
    expect(svg).toContain(`font-family="Credit Figure ${code === "zh-Hans" ? "SC" : "JP"}"`);
  });

  it("normalizes decomposed accents and rejects missing glyphs explicitly", async () => {
    const author = createAuthor("Rene\u0301");
    for (const contribution of author.contributions) contribution.score = 100;
    expect(renderer.svg([author], { acronyms: false })).toContain(">René<");
    const missing = createAuthor("Researcher \u{1F9EA}");
    for (const contribution of missing.contributions) contribution.score = 100;
    expect(() => renderer.svg([missing], { acronyms: false })).toThrow(FigureFontError);
    expect(() => renderer.svg([missing], { acronyms: false })).toThrow(/U\+1F9EA/);
    await expect(renderer.pdf([missing], { acronyms: false })).rejects.toThrow(FigureFontError);
  });

  it("positions an uncomposed Latin accent using its font's mark offsets", async () => {
    const author = createAuthor("q\u0301");
    for (const contribution of author.contributions) contribution.score = 100;
    const bytes = await renderer.pdf([author], { acronyms: false, horizontal: true });
    const document = await PDFDocument.load(bytes);
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

  it.each(["山田太郎", "屠呦呦", "𠮷野"])("renders ink for every glyph of %s without installed fonts", async (name) => {
    const author = createAuthor(name);
    for (const contribution of author.contributions) if (contribution.role === "Software") contribution.score = 100;
    const options = { acronyms: false, horizontal: true, legend: false };
    const svg = renderer.svg([author], options);
    const label = svg.match(new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*><tspan[^>]*>${name}</tspan>`));
    expect(label).not.toBeNull();
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
  });

  it.each(["square", "rounded", "circle"] as const)(
    "exports %s cells with embedded fonts and selectable CJK text",
    async (shape) => {
      const bytes = await renderer.pdf(team(), { acronyms: false, shape, horizontal: true, locale: "ja" });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      const svg = renderer.svg(team(), { acronyms: false, shape, horizontal: true, locale: "ja" });
      expect(doc.getPages()[0]?.getWidth()).toBeCloseTo(Number(svg.match(/width="([\d.]+)"/)?.[1]) * 0.75);
      expect(doc.getPages()[0]?.getHeight()).toBeCloseTo(Number(svg.match(/height="([\d.]+)"/)?.[1]) * 0.75);
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
        expect(text).toContain("屠呦呦");
        expect(text.replace(/\s/g, "")).toContain("Conceptualization");
        expect(execFileSync("pdfimages", ["-list", pdf], { encoding: "utf8" }).trim().split("\n")).toHaveLength(2);
        expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  it.each(AVAILABLE_LOCALES)("retains the $code catalog's Unicode text in PDF", async ({ code }) => {
    const translateRole = makeRoleTranslator(await loadRoleCatalog(code));
    const bytes = await renderer.pdf(team(), {
      locale: code,
      acronyms: false,
      translateRole,
      translateUi: makeUiTranslator(await loadUiCatalog(code)),
    });
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
