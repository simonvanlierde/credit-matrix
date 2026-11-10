import fontkit, { type Font } from "@pdf-lib/fontkit";
import {
  degrees,
  drawText,
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
} from "pdf-lib";
import type { Author } from "./author";
import { escapeXml } from "./export/escape-xml";
import { buildHeatmapSvg, type HeatmapSvgOptions } from "./export/heatmap-svg";

export class FigureFontError extends Error {
  override readonly name = "FigureFontError";

  constructor(readonly characters: string) {
    super(
      `Bundled figure fonts do not contain: ${[...characters]
        .map((character) => `${character} (U+${character.codePointAt(0)?.toString(16).toUpperCase()})`)
        .join(", ")}.`,
    );
  }
}

export interface FigureRenderer {
  svg(authors: Author[], options?: HeatmapSvgOptions): string;
  /** Set a positive width in millimeters, or retain the SVG's natural print size. */
  pdf(authors: Author[], options?: HeatmapSvgOptions, widthMm?: number): Promise<Uint8Array>;
}

interface FigureFont {
  family: string;
  bytes: Uint8Array;
  font: Font;
  uri?: string;
}

interface TextRun {
  text: string;
  font: FigureFont;
}

// PDF text positioning uses glyph advances, so disable optional kerning and ligatures in both formats.
const FEATURES = { kern: false, liga: false, clig: false };

async function readFont(url: URL): Promise<Uint8Array> {
  if (url.protocol === "file:") {
    // Kept dynamic: the same entry runs in the browser, where Node's filesystem does not exist.
    const nodeFilesystem = "node:fs/promises";
    const { readFile } = await import(/* @vite-ignore */ nodeFilesystem);
    return new Uint8Array(await readFile(url));
  }
  // The offline cache can fetch the same large font concurrently; bypass the browser HTTP-cache write race.
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load bundled figure font: ${response.status} ${url.pathname}`);
  return new Uint8Array(await response.arrayBuffer());
}

function attributes(source: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(/(?:^|\s)([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function unescapeXml(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name] ?? "");
}

function width(run: TextRun, size: number): number {
  return (
    run.font.font.layout(run.text, FEATURES).positions.reduce((sum, position) => sum + position.xAdvance, 0) *
    (size / run.font.font.unitsPerEm)
  );
}

function fontUri(font: FigureFont): string {
  if (!font.uri) {
    let binary = "";
    for (let index = 0; index < font.bytes.length; index += 32768)
      binary += String.fromCharCode(...font.bytes.subarray(index, index + 32768));
    font.uri = `data:font/ttf;base64,${btoa(binary)}`;
  }
  return font.uri;
}

function color(hex: string | undefined) {
  if (!hex || hex === "none") return undefined;
  const full = hex.length === 4 ? hex.slice(1).replace(/./g, "$&$&") : hex.slice(1);
  return rgb(
    ...([0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16) / 255) as [number, number, number]),
  );
}

/**
 * Load bundled Noto fonts once, then export figures offline with retained text.
 * SVG embeds standalone fonts; PDF embeds the glyphs used by that figure. Editors
 * can require the full fonts installed locally to change the PDF's text.
 */
export async function createFigureRenderer(): Promise<FigureRenderer> {
  const sources = [
    ["Noto Sans", new URL("./figure-fonts/NotoSans-Regular.ttf", import.meta.url)],
    ["Credit Figure JP", new URL("./figure-fonts/CreditFigureJP.ttf", import.meta.url)],
    ["Credit Figure SC", new URL("./figure-fonts/CreditFigureSC.ttf", import.meta.url)],
    ["Noto Serif", new URL("./figure-fonts/NotoSerif-Regular.ttf", import.meta.url)],
    ["Credit Figure Serif JP", new URL("./figure-fonts/CreditFigureSerifJP.ttf", import.meta.url)],
    ["Credit Figure Serif SC", new URL("./figure-fonts/CreditFigureSerifSC.ttf", import.meta.url)],
  ] as const;
  const fonts = await Promise.all(
    sources.map(async ([family, url]): Promise<FigureFont> => {
      const bytes = await readFont(url);
      return { family, bytes, font: fontkit.create(bytes) };
    }),
  );

  function textRuns(text: string, options?: HeatmapSvgOptions): TextRun[] {
    const selected = options?.font === "serif" ? fonts.slice(3) : fonts.slice(0, 3);
    const ordered = options?.locale?.toLowerCase().startsWith("zh")
      ? [selected[0], selected[2], selected[1]]
      : selected;
    const runs: TextRun[] = [];
    const missing = new Set<string>();
    for (const character of text.normalize("NFC")) {
      const codePoint = character.codePointAt(0) ?? 0;
      const font = ordered.find((candidate) => candidate?.font.hasGlyphForCodePoint(codePoint));
      if (!font) {
        missing.add(character);
        continue;
      }
      const previous = runs.at(-1);
      if (previous?.font === font) previous.text += character;
      else runs.push({ text: character, font });
    }
    if (missing.size) throw new FigureFontError([...missing].join(""));
    return runs;
  }

  function source(authors: Author[], options?: HeatmapSvgOptions): string {
    return buildHeatmapSvg(authors, {
      ...options,
      measureText: (label, size) => textRuns(label, options).reduce((sum, run) => sum + width(run, size), 0),
      measureTextHeight: (label, size) =>
        Math.max(
          size * 1.2,
          ...textRuns(label, options).map(
            ({ font }) =>
              // Browsers round line metrics to pixels; retain a pixel of space after rounding.
              Math.ceil(((font.font.ascent - font.font.descent + font.font.lineGap) * size) / font.font.unitsPerEm) + 1,
          ),
        ),
    });
  }

  return {
    svg(authors, options) {
      const used = new Set<FigureFont>();
      const svg = source(authors, options).replace(
        /<text\b([^>]*)>([^<]*)<\/text>/g,
        (_, attrs: string, text: string) => {
          const runs = textRuns(unescapeXml(text), options);
          const content = runs
            .map((run) => {
              used.add(run.font);
              return `<tspan font-family="${run.font.family}">${escapeXml(run.text)}</tspan>`;
            })
            .join("");
          const ownAttrs = attrs.replace(/ font-family="[^"]*"/, "").replace(/ font-weight="[^"]*"/, "");
          return `<text${ownAttrs} xml:space="preserve">${content}</text>`;
        },
      );
      const style = [...used]
        .map((font) => `@font-face{font-family:'${font.family}';src:url('${fontUri(font)}');font-weight:400}`)
        .join("");
      return svg.replace(
        /(<svg\b[^>]*>)/,
        `$1\n<style>${style}text{font-kerning:none;font-variant-ligatures:none}</style>`,
      );
    },

    async pdf(authors, options, widthMm) {
      if (widthMm !== undefined && (!Number.isFinite(widthMm) || widthMm <= 0))
        throw new RangeError("Figure width must be a positive finite number of millimeters.");
      const svg = source(authors, options);
      const root = attributes(svg.slice(0, svg.indexOf(">")));
      const pageWidth = Number(root.width);
      const pageHeight = Number(root.height);
      const document = await PDFDocument.create();
      document.registerFontkit(fontkit);
      document.setTitle(unescapeXml(svg.match(/<title>([^<]*)<\/title>/)?.[1] ?? "Contribution heatmap"));
      document.setSubject(unescapeXml(svg.match(/<desc>([^<]*)<\/desc>/)?.[1] ?? ""));
      if (options?.locale) document.catalog.set(PDFName.of("Lang"), PDFString.of(options.locale));
      const page = document.addPage([pageWidth, pageHeight]);
      const embedded = new Map<FigureFont, PDFFont>();
      const groups: Record<string, string>[] = [];
      const supported = new Set(["svg", "title", "desc", "rect", "text", "g", "circle", "path"]);

      // Only the shared renderer's own markup reaches this parser, never caller-provided SVG.
      for (const match of svg.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?=\s|\/?>)([^<>]*)>(?:([^<]*)<\/text>)?/g)) {
        const tag = match[2] ?? "";
        if (!supported.has(tag)) throw new Error(`Unsupported figure primitive: ${tag}.`);
        if (match[1]) {
          if (tag === "g") groups.pop();
          continue;
        }
        const attrs = { ...groups.at(-1), ...attributes(match[3] ?? "") };
        if (tag === "g") {
          if (attrs.transform) throw new Error("Unsupported figure group transform.");
          groups.push(attrs);
          continue;
        }
        if (tag === "svg" || tag === "title" || tag === "desc") continue;
        const x = Number(attrs.x ?? 0);
        const y = Number(attrs.y ?? 0);
        if (tag === "circle") {
          page.drawCircle({
            x: Number(attrs.cx),
            y: pageHeight - Number(attrs.cy),
            size: Number(attrs.r),
            color: color(attrs.fill),
          });
          continue;
        }
        if (tag === "path") {
          if (!attrs.d) throw new Error("Figure path has no vector data.");
          page.pushOperators(
            pushGraphicsState(),
            setLineJoin(attrs["stroke-linejoin"] === "round" ? LineJoinStyle.Round : LineJoinStyle.Miter),
          );
          page.drawSvgPath(attrs.d, {
            x: 0,
            y: pageHeight,
            color: color(attrs.fill),
            borderColor: color(attrs.stroke),
            borderWidth: Number(attrs["stroke-width"] ?? 0),
            borderLineCap: attrs["stroke-linecap"] === "round" ? LineCapStyle.Round : LineCapStyle.Butt,
          });
          page.pushOperators(popGraphicsState());
          continue;
        }
        if (tag === "rect") {
          const w = Number(attrs.width);
          const h = Number(attrs.height);
          const r = Math.min(Number(attrs.rx ?? 0), w / 2, h / 2);
          const drawOptions = {
            color: color(attrs.fill),
            borderColor: color(attrs.stroke),
            borderWidth: Number(attrs["stroke-width"] ?? 0),
          };
          if (r > 0) {
            // SVG's rounded rectangles become vector arcs, retaining the same corner radii.
            const path = `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
            page.drawSvgPath(path, { x: 0, y: pageHeight, ...drawOptions });
          } else page.drawRectangle({ x, y: pageHeight - y - h, width: w, height: h, ...drawOptions });
          continue;
        }

        const runs = textRuns(unescapeXml(match[4] ?? ""), options);
        const size = Number(attrs["font-size"]);
        const transform = attrs.transform?.match(/^translate\(([^,]+),([^)]+)\) rotate\(([^)]+)\)$/);
        const originX = transform ? Number(transform[1]) : x;
        const originY = transform ? Number(transform[2]) : y;
        const angle = transform ? -Number(transform[3]) : 0;
        const radians = (angle * Math.PI) / 180;
        let advance = attrs["text-anchor"] === "end" ? -runs.reduce((sum, run) => sum + width(run, size), 0) : 0;
        for (const run of runs) {
          let font = embedded.get(run.font);
          if (!font) {
            font = await document.embedFont(run.font.bytes, {
              subset: true,
              features: FEATURES,
              customName: `CMFIGR+${run.font.font.postscriptName}`,
            });
            embedded.set(run.font, font);
          }
          const layout = run.font.font.layout(run.text, FEATURES);
          const positioned = layout.positions.some(
            (position, index) =>
              position.xOffset ||
              position.yOffset ||
              position.yAdvance ||
              position.xAdvance !== layout.glyphs[index]?.advanceWidth,
          );
          if (positioned) {
            // PDF-lib's drawText drops mark attachment offsets; encode first to retain its subset and Unicode mapping.
            const codes = font.encodeText(run.text).asString().match(/.{4}/g) ?? [];
            const key = page.node.newFontDictionary(font.name, font.ref);
            const unit = size / run.font.font.unitsPerEm;
            let glyphX = advance;
            let glyphY = 0;
            for (const [index, position] of layout.positions.entries()) {
              const glyphCode = codes[index];
              if (!glyphCode) throw new Error("Figure glyph layout and PDF encoding do not match.");
              const offsetX = glyphX + position.xOffset * unit;
              const offsetY = glyphY + position.yOffset * unit;
              page.pushOperators(
                ...drawText(PDFHexString.of(glyphCode), {
                  x: originX + offsetX * Math.cos(radians) - offsetY * Math.sin(radians),
                  y: pageHeight - originY + offsetX * Math.sin(radians) + offsetY * Math.cos(radians),
                  size,
                  font: key,
                  color: color(attrs.fill) ?? rgb(0, 0, 0),
                  rotate: degrees(angle),
                  xSkew: degrees(0),
                  ySkew: degrees(0),
                }),
              );
              glyphX += position.xAdvance * unit;
              glyphY += position.yAdvance * unit;
            }
          } else {
            page.drawText(run.text, {
              x: originX + advance * Math.cos(radians),
              y: pageHeight - originY + advance * Math.sin(radians),
              size,
              font,
              color: color(attrs.fill),
              rotate: degrees(angle),
            });
          }
          advance += width(run, size);
        }
      }
      // SVG pixels are 1/96 inch; PDF points are 1/72 inch. Keep their natural print sizes equal.
      const printScale = widthMm === undefined ? 0.75 : (widthMm * 72) / (25.4 * pageWidth);
      page.scaleContent(printScale, printScale);
      page.setSize(pageWidth * printScale, pageHeight * printScale);
      return document.save();
    },
  };
}
