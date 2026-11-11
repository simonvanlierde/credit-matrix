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
import { hexRgb } from "./contributor-color";
import { escapeXml } from "./export/escape-xml";
import { buildHeatmapSvg, type HeatmapSvgOptions } from "./export/heatmap-svg";
import { defaultFigureFonts, type FigureFace, type FigureFontProvider } from "./figure-fonts";

export type { FigureFace, FigureFontProvider } from "./figure-fonts";

export class FigureFontError extends Error {
  override readonly name = "FigureFontError";

  constructor(readonly characters: string) {
    super(
      `The figure fonts cannot draw ${[...characters]
        .map((character) => `${character} (U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")})`)
        .join(", ")}. Change these characters in the names or labels.`,
    );
  }
}

export interface FigureSvgOptions extends HeatmapSvgOptions {
  /**
   * What SVG does with a character the figure faces cannot draw: `"error"` (the default) throws
   * `FigureFontError`; `"system"` draws that run in the system font stack `buildHeatmapSvg` uses,
   * so its look then depends on the viewer's installed fonts. A face that cannot be loaded at all
   * gives system-font runs either way, with a console warning.
   */
  fallback?: "system" | "error";
}

export interface FigureRenderer {
  svg(authors: Author[], options?: FigureSvgOptions): Promise<string>;
  /** Set a positive width in millimeters, or retain the SVG's natural print size. */
  pdf(authors: Author[], options?: HeatmapSvgOptions, widthMm?: number): Promise<Uint8Array>;
}

export interface FigureRendererOptions {
  /**
   * Where each face's bytes come from. The default reads the installed `credit-matrix-fonts` package,
   * otherwise downloads the face from its pinned release on jsDelivr, checks its SHA-256 and caches it.
   */
  fonts?: FigureFontProvider;
}

interface FontSource {
  family: string;
  face: FigureFace;
}

interface FigureFont {
  family: string;
  bytes: Uint8Array;
  font: Font;
}

interface TextRun {
  text: string;
  /** Undefined for a fallback run that no bundled face can draw. */
  font: FigureFont | undefined;
}

// Order: sans Latin, JP, SC, then the serif three.
const SOURCES: FontSource[] = [
  { family: "Noto Sans", face: "sans" },
  { family: "Credit Figure JP", face: "sans-jp" },
  { family: "Credit Figure SC", face: "sans-sc" },
  { family: "Noto Serif", face: "serif" },
  { family: "Credit Figure Serif JP", face: "serif-jp" },
  { family: "Credit Figure Serif SC", face: "serif-sc" },
];

/** Thrown while laying out text that needs a face not yet loaded; the caller loads it and lays out again. */
class UnloadedFace extends Error {
  constructor(readonly source: FontSource) {
    super(`Figure font ${source.family} is not loaded.`);
  }
}

// PDF text positioning uses glyph advances, so disable optional kerning and ligatures in both formats.
const FEATURES = { kern: false, liga: false, clig: false };

function attributes(source: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(/(?:^|\s)([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function unescapeXml(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name] ?? "");
}

function width(run: TextRun, size: number): number {
  // Unknown system glyphs: a full em each leaves room for the widest of them.
  if (!run.font) return [...run.text].length * size;
  return (
    run.font.font.layout(run.text, FEATURES).positions.reduce((sum, position) => sum + position.xAdvance, 0) *
    (size / run.font.font.unitsPerEm)
  );
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

function checksum(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) sum = (sum + view.getUint32(offset)) % 2 ** 32;
  return sum;
}

/** Read an OpenType file's tables by tag. */
function sfntTables(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, Uint8Array>();
  for (let index = 0; index < view.getUint16(4); index++) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    const offset = view.getUint32(record + 8);
    tables.set(tag, bytes.subarray(offset, offset + view.getUint32(record + 12)));
  }
  return tables;
}

/** Write a TrueType file from its tables, with the checksums browsers' font sanitizers verify. */
function sfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const padded = tags.map((tag) => {
    const table = tables.get(tag) ?? new Uint8Array();
    const copy = new Uint8Array(Math.ceil(table.length / 4) * 4);
    copy.set(table);
    if (tag === "head") copy.fill(0, 8, 12);
    return copy;
  });
  const header = 12 + tags.length * 16;
  const bytes = new Uint8Array(header + padded.reduce((sum, table) => sum + table.length, 0));
  const view = new DataView(bytes.buffer);
  const power = 2 ** Math.floor(Math.log2(tags.length));
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tags.length);
  view.setUint16(6, power * 16);
  view.setUint16(8, Math.log2(power));
  view.setUint16(10, tags.length * 16 - power * 16);
  let offset = header;
  let headOffset = 0;
  for (const [index, tag] of tags.entries()) {
    const table = padded[index] ?? new Uint8Array();
    const record = 12 + index * 16;
    for (let char = 0; char < 4; char++) bytes[record + char] = tag.charCodeAt(char);
    view.setUint32(record + 4, checksum(table));
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, tables.get(tag)?.length ?? 0);
    bytes.set(table, offset);
    if (tag === "head") headOffset = offset;
    offset += table.length;
  }
  view.setUint32(headOffset + 8, (0xb1b0afba - checksum(bytes) + 2 ** 32) % 2 ** 32);
  return bytes;
}

/** A cmap with a BMP format 4 and a full format 12 subtable, mapping each code point to its subset glyph. */
function cmap(glyphs: Map<number, number>): Uint8Array {
  const points = [...glyphs.keys()].sort((a, b) => a - b);
  const bmp = [...points.filter((point) => point < 0xffff), 0xffff];
  const format4 = new DataView(new ArrayBuffer(16 + bmp.length * 8));
  const segments = bmp.length;
  const power = 2 ** Math.floor(Math.log2(segments));
  format4.setUint16(0, 4);
  format4.setUint16(2, format4.byteLength);
  format4.setUint16(6, segments * 2);
  format4.setUint16(8, power * 2);
  format4.setUint16(10, Math.log2(power));
  format4.setUint16(12, segments * 2 - power * 2);
  for (const [index, point] of bmp.entries()) {
    format4.setUint16(14 + index * 2, point);
    format4.setUint16(16 + segments * 2 + index * 2, point);
    format4.setUint16(16 + segments * 4 + index * 2, ((glyphs.get(point) ?? 0) - point + 0x10000) % 0x10000);
  }
  // The final 0xFFFF segment maps to glyph 0, as the format requires.
  format4.setUint16(16 + segments * 4 + (segments - 1) * 2, 1);
  const format12 = new DataView(new ArrayBuffer(16 + points.length * 12));
  format12.setUint16(0, 12);
  format12.setUint32(4, format12.byteLength);
  format12.setUint32(12, points.length);
  for (const [index, point] of points.entries()) {
    format12.setUint32(16 + index * 12, point);
    format12.setUint32(20 + index * 12, point);
    format12.setUint32(24 + index * 12, glyphs.get(point) ?? 0);
  }
  const table = new Uint8Array(20 + format4.byteLength + format12.byteLength);
  const view = new DataView(table.buffer);
  view.setUint16(2, 2);
  view.setUint16(4, 3);
  view.setUint16(6, 1);
  view.setUint32(8, 20);
  view.setUint16(12, 3);
  view.setUint16(14, 10);
  view.setUint32(16, 20 + format4.byteLength);
  table.set(new Uint8Array(format4.buffer), 20);
  table.set(new Uint8Array(format12.buffer), 20 + format4.byteLength);
  return table;
}

/**
 * A standalone font holding only these characters' glyphs, from the subsetter that also feeds the PDF.
 * NOTE: the subset has no GSUB or GPOS, so a browser places an uncomposed combining mark without its anchor.
 */
async function webFont(face: FigureFont, characters: Set<string>): Promise<Uint8Array> {
  const subset = face.font.createSubset();
  const glyphs = new Map<number, number>();
  for (const character of characters) {
    const point = character.codePointAt(0) ?? 0;
    glyphs.set(point, subset.includeGlyph(face.font.glyphForCodePoint(point)));
  }
  const encoded = await new Promise<Uint8Array>((resolve) => {
    const parts: Uint8Array[] = [];
    subset
      .encodeStream()
      .on("data", (part: Uint8Array) => parts.push(part))
      .on("end", () => {
        const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        resolve(bytes);
      });
  });
  // The PDF subsetter writes only the tables a PDF reads; a web font also needs these four.
  const original = sfntTables(face.bytes);
  const tables = sfntTables(encoded);
  tables.set("cmap", cmap(glyphs));
  for (const tag of ["OS/2", "name"]) {
    const table = original.get(tag);
    if (table) tables.set(tag, table);
  }
  // post version 3 names no glyphs, so it stays valid for the renumbered subset.
  const post = new Uint8Array(32);
  post.set((original.get("post") ?? new Uint8Array(32)).subarray(0, 32));
  new DataView(post.buffer).setUint32(0, 0x00030000);
  tables.set("post", post);
  return sfnt(tables);
}

function color(hex: string | undefined) {
  if (!hex || hex === "none") return undefined;
  const [r, g, b] = hexRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
}

/**
 * Export figures with retained text and embedded Noto fonts. Each face loads on the first figure whose text
 * needs it. SVG and PDF embed only the glyphs that figure uses; editors can require the full fonts
 * installed locally to change its text.
 */
export function createFigureRenderer(rendererOptions: FigureRendererOptions = {}): FigureRenderer {
  const loaded = new Map<FontSource, FigureFont>();
  const loading = new Map<FontSource, Promise<void>>();

  function load(source: FontSource): Promise<void> {
    let pending = loading.get(source);
    if (!pending) {
      const fonts = rendererOptions.fonts ?? defaultFigureFonts;
      pending = Promise.resolve()
        .then(() => fonts(source.face))
        .then((bytes) => {
          loaded.set(source, { family: source.family, bytes, font: fontkit.create(bytes) });
        })
        .catch((error: unknown) => {
          // A failed download can be retried by the next export.
          loading.delete(source);
          throw error;
        });
      loading.set(source, pending);
    }
    return pending;
  }

  /**
   * Run a layout, loading each face it asks for, until every face its text needs is in memory. With
   * `unavailable`, a face that fails to load is added to it and the layout draws that text in system fonts.
   */
  async function withFaces<T>(layout: () => T, unavailable?: Set<FontSource>): Promise<T> {
    for (;;) {
      try {
        return layout();
      } catch (error) {
        if (!(error instanceof UnloadedFace)) throw error;
        try {
          await load(error.source);
        } catch (loadError) {
          if (!unavailable) throw loadError;
          // biome-ignore lint/suspicious/noConsole: the figure still renders; say why it looks different.
          console.warn(
            `${loadError instanceof Error ? loadError.message : String(loadError)} Drawing its text in system fonts.`,
          );
          unavailable.add(error.source);
        }
      }
    }
  }

  function face(source: FontSource | undefined): FigureFont {
    if (!source) throw new Error("Missing figure font source.");
    const font = loaded.get(source);
    if (!font) throw new UnloadedFace(source);
    return font;
  }

  function textRuns(text: string, options?: FigureSvgOptions, unavailable?: Set<FontSource>): TextRun[] {
    const [latin, japanese, chinese] = options?.font === "serif" ? SOURCES.slice(3) : SOURCES.slice(0, 3);
    const locale = options?.locale?.toLowerCase() ?? "";
    const normalized = text.normalize("NFC");
    // Han is shared by Japanese and Chinese: kana or a Japanese locale selects Japanese glyph forms.
    const cjk =
      /^ja\b/.test(locale) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)
        ? [japanese, chinese]
        : [chinese, japanese];
    // Chinese typesets quotes, dashes and ellipses beside Han at full width, as its own face draws them.
    const cjkPunctuation = /^zh\b/.test(locale) && /\p{Script=Han}/u.test(normalized);
    const runs: TextRun[] = [];
    const missing = new Set<string>();
    for (const character of normalized) {
      const codePoint = character.codePointAt(0) ?? 0;
      const order = cjkPunctuation && codePoint > 0x7f && /\p{P}/u.test(character) ? [...cjk, latin] : [latin, ...cjk];
      let font: FigureFont | undefined;
      let skipped = false;
      // In order, so a face loads only when every face before it lacks the character.
      for (const source of order) {
        if (source && unavailable?.has(source)) {
          skipped = true;
          continue;
        }
        const candidate = face(source);
        if (!candidate.font.hasGlyphForCodePoint(codePoint)) continue;
        font = candidate;
        break;
      }
      if (!font && !skipped && options?.fallback !== "system") {
        missing.add(character);
        continue;
      }
      const previous = runs.at(-1);
      if (previous && previous.font === font) previous.text += character;
      else runs.push({ text: character, font });
    }
    if (missing.size) throw new FigureFontError([...missing].join(""));
    return runs;
  }

  function layoutSvg(authors: Author[], options?: FigureSvgOptions, unavailable?: Set<FontSource>): string {
    return buildHeatmapSvg(authors, {
      ...options,
      measureText: (label, size) =>
        textRuns(label, options, unavailable).reduce((sum, run) => sum + width(run, size), 0),
      measureTextHeight: (label, size) =>
        Math.max(
          size * 1.2,
          ...textRuns(label, options, unavailable).map(({ font }) =>
            font
              ? // Browsers round line metrics to pixels; retain a pixel of space after rounding.
                Math.ceil(((font.font.ascent - font.font.descent + font.font.lineGap) * size) / font.font.unitsPerEm) +
                1
              : // System fonts for Thai or Devanagari stack marks above and below the line.
                Math.ceil(size * 1.5),
          ),
        ),
    });
  }

  return {
    async svg(authors, options) {
      const used = new Map<FigureFont, Set<string>>();
      const unavailable = new Set<FontSource>();
      const svg = await withFaces(() => {
        used.clear();
        return layoutSvg(authors, options, unavailable).replace(
          /<text\b([^>]*)>([^<]*)<\/text>/g,
          (_, attrs: string, text: string) => {
            const system = attrs.match(/ font-family="([^"]*)"/)?.[1] ?? "sans-serif";
            const content = textRuns(unescapeXml(text), options, unavailable)
              .map((run) => {
                if (!run.font) return `<tspan font-family="${system}">${escapeXml(run.text)}</tspan>`;
                const characters = used.get(run.font) ?? new Set<string>();
                for (const character of run.text) characters.add(character);
                used.set(run.font, characters);
                return `<tspan font-family="${run.font.family}">${escapeXml(run.text)}</tspan>`;
              })
              .join("");
            const ownAttrs = attrs.replace(/ font-family="[^"]*"/, "").replace(/ font-weight="[^"]*"/, "");
            return `<text${ownAttrs} xml:space="preserve">${content}</text>`;
          },
        );
      }, unavailable);
      const faces = await Promise.all(
        [...used].map(
          async ([font, characters]) =>
            `@font-face{font-family:'${font.family}';src:url('data:font/ttf;base64,${base64(await webFont(font, characters))}');font-weight:400}`,
        ),
      );
      return svg.replace(
        /(<svg\b[^>]*>)/,
        `$1\n<style>${faces.join("")}text{font-kerning:none;font-variant-ligatures:none}</style>`,
      );
    },

    async pdf(authors, options, widthMm) {
      if (widthMm !== undefined && (!Number.isFinite(widthMm) || widthMm <= 0))
        throw new RangeError("Figure width must be a positive finite number of millimeters.");
      const strict = { ...options, fallback: "error" as const };
      const svg = await withFaces(() => {
        const layout = layoutSvg(authors, strict);
        for (const [, text] of layout.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g))
          textRuns(unescapeXml(text ?? ""), strict);
        return layout;
      });
      const root = attributes(svg.slice(0, svg.indexOf(">")));
      const pageWidth = Number(root.width);
      const pageHeight = Number(root.height);
      // Without pdf-lib's own producer and current dates, the same figure gives the same bytes.
      const document = await PDFDocument.create({ updateMetadata: false });
      document.setProducer("CRediT Matrix");
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

        const runs = textRuns(unescapeXml(match[4] ?? ""), strict);
        const size = Number(attrs["font-size"]);
        const transform = attrs.transform?.match(/^translate\(([^,]+),([^)]+)\) rotate\(([^)]+)\)$/);
        const originX = transform ? Number(transform[1]) : x;
        const originY = transform ? Number(transform[2]) : y;
        const angle = transform ? -Number(transform[3]) : 0;
        const radians = (angle * Math.PI) / 180;
        let advance = attrs["text-anchor"] === "end" ? -runs.reduce((sum, run) => sum + width(run, size), 0) : 0;
        for (const run of runs) {
          const runFace = run.font;
          if (!runFace) throw new FigureFontError(run.text);
          let font = embedded.get(runFace);
          if (!font) {
            font = await document.embedFont(runFace.bytes, {
              subset: true,
              features: FEATURES,
              customName: `CMFIGR+${runFace.font.postscriptName}`,
            });
            embedded.set(runFace, font);
          }
          const layout = runFace.font.layout(run.text, FEATURES);
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
            const unit = size / runFace.font.unitsPerEm;
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
