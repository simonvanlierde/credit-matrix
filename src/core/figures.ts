import fontkit, { type Font } from "@pdf-lib/fontkit";
import { degrees, drawText, PDFDocument, type PDFFont, PDFHexString, PDFName, PDFString, rgb } from "pdf-lib";
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
  pdf(authors: Author[], options?: HeatmapSvgOptions): Promise<Uint8Array>;
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
  const response = await fetch(url);
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
  ] as const;
  const fonts = await Promise.all(
    sources.map(async ([family, url]): Promise<FigureFont> => {
      const bytes = await readFont(url);
      return { family, bytes, font: fontkit.create(bytes) };
    }),
  );

  function textRuns(text: string, locale?: string): TextRun[] {
    const ordered = locale?.toLowerCase().startsWith("zh") ? [fonts[0], fonts[2], fonts[1]] : fonts;
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
      measureText: (label, size) => textRuns(label, options?.locale).reduce((sum, run) => sum + width(run, size), 0),
    });
  }

  return {
    svg(authors, options) {
      const used = new Set<FigureFont>();
      const svg = source(authors, options).replace(
        /<text\b([^>]*)>([^<]*)<\/text>/g,
        (_, attrs: string, text: string) => {
          const runs = textRuns(unescapeXml(text), options?.locale);
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

    async pdf(authors, options) {
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

      // Only this renderer's own rect/text markup reaches this parser, never caller-provided SVG.
      for (const match of svg.matchAll(/<(rect|text)\b([^>]*?)(?:\/>|>([^<]*)<\/text>)/g)) {
        const attrs = attributes(match[2] ?? "");
        const x = Number(attrs.x ?? 0);
        const y = Number(attrs.y ?? 0);
        if (match[1] === "rect") {
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

        const runs = textRuns(unescapeXml(match[3] ?? ""), options?.locale);
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
      page.scaleContent(0.75, 0.75);
      page.setSize(pageWidth * 0.75, pageHeight * 0.75);
      return document.save();
    },
  };
}
