import fontkit, { type Font } from "@pdf-lib/fontkit";
import {
  degrees,
  drawText,
  LineCapStyle,
  LineJoinStyle,
  PDFArray,
  PDFDict,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFStream,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
} from "pdf-lib";
import type { Author } from "./author";
import { hexRgb } from "./contributor-color";
import { escapeXml } from "./export/escape-xml";
import { buildHeatmapSvg, HeatmapOptionError, type HeatmapSvgOptions } from "./export/heatmap-svg";
import { defaultFigureFonts, type FigureFace, FigureFontFileError, type FigureFontProvider } from "./figure-fonts";
import type { FoundFont } from "./font-search";
import { createShaper, type ShapedFace, type ShapedGlyph, type Shaper } from "./shaping";
import { createSubsetter, type SubsetFace, type Subsetter } from "./subset";

export type { FigureFace, FigureFontProvider } from "./figure-fonts";
export { FigureFontFileError } from "./figure-fonts";

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

export interface FigureOptions extends Omit<HeatmapSvgOptions, "font"> {
  /**
   * `"sans"` (the default), `"serif"`, or the name of an installed font family (name ID 16, else 1, any case),
   * in Node only. The family's upright regular face draws Latin and every other character it has, except the
   * complex scripts and emoji, which keep their own faces; the sans faces draw what it lacks.
   */
  font?: "sans" | "serif" | (string & {});
  /** Folders searched for a `font` family before the system font folders, the first one first. */
  fontPath?: string[];
  /** Search only `fontPath`, not the system font folders. */
  ignoreSystemFonts?: boolean;
  /**
   * The built-in faces that draw what a `font` family lacks. Defaults to the family's own classification
   * (OS/2 sFamilyClass, else PANOSE): serif for a serif family, else sans.
   */
  fontFallback?: "sans" | "serif";
}

export interface FigureSvgOptions extends FigureOptions {
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
  pdf(authors: Author[], options?: FigureOptions, widthMm?: number): Promise<Uint8Array>;
}

/** The file a `font` family was found in, reported once per renderer and family. */
export interface FigureFontReport {
  family: string;
  file: string;
  /** Set when the font's OS/2 embedding permission restricts sharing documents that embed it. */
  warning?: string;
}

export interface FigureRendererOptions {
  /**
   * Where each face's bytes come from. The default reads the installed `credit-matrix-fonts` package,
   * otherwise downloads the face from its pinned release on jsDelivr, checks its SHA-256 and caches it.
   */
  fonts?: FigureFontProvider;
  /** Called when a `font` family is found. Without it, only a permission warning is printed, to the console. */
  onFont?: (report: FigureFontReport) => void;
}

interface FontSource {
  family: string;
  face: FigureFace;
  /** A `font` family that classes itself as serif. */
  serif?: boolean;
  /** A complex script: HarfBuzz lays it out, and SVG embeds the whole face so viewers keep its shaping tables. */
  shaped?: boolean;
}

interface FigureFont {
  family: string;
  bytes: Uint8Array;
  font: Font;
  shaped: boolean;
  /** OS/2 fsType 0x0100: embedded whole, never subset. */
  noSubset: boolean;
}

/** The options one export lays out with, its `font` family found. */
interface Layout extends FigureSvgOptions {
  custom?: FontSource;
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

// Shaped for its ZWJ sequences and skin tones; its own space is 1.27 em wide, so spaces stay out of its runs.
const EMOJI: FontSource = { family: "Credit Figure Emoji", face: "emoji", shaped: true };
const KEYCAP = /^[\d#*]\ufe0f?\u20e3/u;

// Each other script's face, sans and serif; Korean has only its sans face, used in serif figures too.
// Fontkit draws Hangul, as it does CJK.
const KOREAN: FontSource = { family: "Credit Figure KR", face: "sans-kr" };
const SCRIPT_FACES: [RegExp, sans: FontSource, serif: FontSource][] = [
  [/\p{Script=Hangul}/u, KOREAN, KOREAN],
  [/[\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Regional_Indicator}]/u, EMOJI, EMOJI],
  ...(
    [
      ["Arabic", "sans-arabic", "Noto Naskh Arabic", "serif-arabic"],
      ["Armenian", "sans-armenian", "Noto Serif Armenian", "serif-armenian"],
      ["Bengali", "sans-bengali", "Noto Serif Bengali", "serif-bengali"],
      ["Devanagari", "sans-devanagari", "Noto Serif Devanagari", "serif-devanagari"],
      ["Ethiopic", "sans-ethiopic", "Noto Serif Ethiopic", "serif-ethiopic"],
      ["Georgian", "sans-georgian", "Noto Serif Georgian", "serif-georgian"],
      ["Gujarati", "sans-gujarati", "Noto Serif Gujarati", "serif-gujarati"],
      ["Gurmukhi", "sans-gurmukhi", "Noto Serif Gurmukhi", "serif-gurmukhi"],
      ["Hebrew", "sans-hebrew", "Noto Serif Hebrew", "serif-hebrew"],
      ["Kannada", "sans-kannada", "Noto Serif Kannada", "serif-kannada"],
      ["Khmer", "sans-khmer", "Noto Serif Khmer", "serif-khmer"],
      ["Lao", "sans-lao", "Noto Serif Lao", "serif-lao"],
      ["Malayalam", "sans-malayalam", "Noto Serif Malayalam", "serif-malayalam"],
      ["Myanmar", "sans-myanmar", "Noto Serif Myanmar", "serif-myanmar"],
      ["Oriya", "sans-oriya", "Noto Serif Oriya", "serif-oriya"],
      ["Sinhala", "sans-sinhala", "Noto Serif Sinhala", "serif-sinhala"],
      ["Tamil", "sans-tamil", "Noto Serif Tamil", "serif-tamil"],
      ["Telugu", "sans-telugu", "Noto Serif Telugu", "serif-telugu"],
      ["Thai", "sans-thai", "Noto Serif Thai", "serif-thai"],
    ] as const
  ).map(([script, face, serifFamily, serifFace]): [RegExp, FontSource, FontSource] => [
    new RegExp(`\\p{Script=${script}}`, "u"),
    { family: `Noto Sans ${script}`, face, shaped: true },
    { family: serifFamily, face: serifFace, shaped: true },
  ]),
];

/** The shaping engine, loaded through the font provider the first time a complex script needs it. */
const HARFBUZZ: FontSource = { family: "HarfBuzz", face: "harfbuzz" };
/** The subsetter, loaded the first time an export embeds a face. */
const SUBSETTER: FontSource = { family: "HarfBuzz subset", face: "harfbuzz-subset" };

// Right-to-left letters: only labels with these need the bidi algorithm.
const RTL_TEXT = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;

/** Thrown while laying out text that needs a face not yet loaded; the caller loads it and lays out again. */
class UnloadedFace extends Error {
  constructor(readonly source: FontSource) {
    super(`Figure font ${source.family} is not loaded.`);
  }
}

// Han, kana, CJK symbols and fullwidth forms: the CJK faces draw them, not the Latin face.
const CJK_TEXT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u30ff\uff00-\uffef]/u;

// PDF text positioning uses glyph advances, so disable optional kerning and ligatures in both formats.
const FEATURES = { kern: false, liga: false, clig: false };

function attributes(source: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(/(?:^|\s)([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function unescapeXml(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name] ?? "");
}

/** A family name as a quoted CSS string, escaped for an XML attribute or `<style>`: unquoted, a name such as
 * "Noto Sans (custom)" or one starting with a digit is invalid CSS, and the viewer draws its default font. */
function cssFamily(family: string): string {
  return `'${escapeXml(family.replace(/['\\]/g, "\\$&"))}'`;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

function color(hex: string | undefined) {
  if (!hex || hex === "none") return undefined;
  const [r, g, b] = hexRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
}

/**
 * Export figures with retained text and embedded Noto fonts, or a font family the caller names. Each face
 * loads on the first figure whose text needs it. SVG and PDF embed only the glyphs that figure uses; editors
 * can require the full fonts installed locally to change its text.
 */
export function createFigureRenderer(rendererOptions: FigureRendererOptions = {}): FigureRenderer {
  // Before 0.13.0 the renderer took fontFallback (a font URL); the name now means a per-call sans or serif.
  if ("fontFallback" in rendererOptions)
    throw new HeatmapOptionError(
      "createFigureRenderer takes fonts instead of fontFallback; fontFallback is now a per-call sans or serif option.",
    );
  const loaded = new Map<FontSource, FigureFont>();
  const loading = new Map<FontSource, Promise<void>>();
  // Faces already warned about: the app redraws its preview on every settings change.
  const warned = new Set<FontSource>();
  let shaper: Shaper | undefined;
  const shapedFaces = new Map<FigureFont, ShapedFace>();
  let subsetter: Subsetter | undefined;
  const subsetFaces = new Map<FigureFont, SubsetFace>();
  // Each `font` family search, by family, font path and system-font switch.
  const customFonts = new Map<string, Promise<FontSource>>();

  function load(source: FontSource): Promise<void> {
    let pending = loading.get(source);
    if (!pending) {
      const fonts = rendererOptions.fonts ?? defaultFigureFonts;
      pending = Promise.resolve()
        .then(() => fonts(source.face))
        .then(async (bytes) => {
          if (source === HARFBUZZ) shaper = await createShaper(bytes);
          else if (source === SUBSETTER) subsetter = await createSubsetter(bytes);
          else
            loaded.set(source, {
              family: source.family,
              bytes,
              font: fontkit.create(bytes),
              shaped: source.shaped === true,
              noSubset: false,
            });
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
          if (!warned.has(error.source))
            // biome-ignore lint/suspicious/noConsole: the figure still renders; say why it looks different.
            console.warn(
              `${loadError instanceof Error ? loadError.message : String(loadError)} Drawing its text in system fonts.`,
            );
          warned.add(error.source);
          unavailable.add(error.source);
        }
      }
    }
  }

  /** Find the options' `font` family, once per renderer; undefined for sans and serif. */
  function customFont(options: FigureOptions | undefined): Promise<FontSource | undefined> {
    const family = options?.font;
    const fallback = options?.fontFallback;
    if (fallback !== undefined && fallback !== "sans" && fallback !== "serif")
      return Promise.reject(new HeatmapOptionError("Figure font fallback must be sans or serif."));
    if (family === undefined || family === "sans" || family === "serif") return Promise.resolve(undefined);
    const key = JSON.stringify([family.trim().toLowerCase(), options?.fontPath ?? [], options?.ignoreSystemFonts]);
    let pending = customFonts.get(key);
    if (!pending) {
      pending = import("./font-search")
        .then(({ findFigureFont }) =>
          findFigureFont(family, { fontPath: options?.fontPath, ignoreSystemFonts: options?.ignoreSystemFonts }),
        )
        .then((found: FoundFont) => {
          // The SVG's @font-face rules go by family name: a custom "Noto Sans" beside the built-in fallback
          // Noto Sans would share one name, and a viewer would use only one of the two subsets.
          const builtIn = [...SOURCES, ...SCRIPT_FACES.flatMap(([, sans, serif]) => [sans, serif]), EMOJI].some(
            (known) => known.family.toLowerCase() === found.family.toLowerCase(),
          );
          const svgFamily = builtIn ? `${found.family} (custom)` : found.family;
          const source: FontSource = { family: svgFamily, face: "sans", serif: found.serif };
          loaded.set(source, {
            family: svgFamily,
            bytes: found.bytes,
            font: fontkit.create(found.bytes),
            shaped: false,
            noSubset: found.noSubset,
          });
          if (rendererOptions.onFont)
            rendererOptions.onFont({ family: found.family, file: found.file, warning: found.warning });
          // biome-ignore lint/suspicious/noConsole: the figure still renders; the font's license may restrict it.
          else if (found.warning) console.warn(found.warning);
          return source;
        });
      // A failed search runs again on the next export, after the caller installs the font.
      pending.catch(() => customFonts.delete(key));
      customFonts.set(key, pending);
    }
    return pending;
  }

  /** The bytes a document embeds for a face: its glyphs for these characters, or the whole face. */
  function embeddable(font: FigureFont, characters: Iterable<string>, retainGids: boolean): Uint8Array {
    if (font.noSubset) return font.bytes;
    if (!subsetter) throw new UnloadedFace(SUBSETTER);
    let subsetFace = subsetFaces.get(font);
    if (!subsetFace) {
      subsetFace = subsetter.face(font.bytes);
      subsetFaces.set(font, subsetFace);
    }
    return subsetFace.subset(
      [...characters].map((character) => character.codePointAt(0) ?? 0),
      retainGids,
    );
  }

  function face(source: FontSource | undefined): FigureFont {
    if (!source) throw new Error("Missing figure font source.");
    const font = loaded.get(source);
    if (!font) throw new UnloadedFace(source);
    return font;
  }

  /** HarfBuzz's glyphs for a complex-script run, in visual order. */
  function shape(font: FigureFont, text: string, rtl: boolean): ShapedGlyph[] {
    if (!shaper) throw new UnloadedFace(HARFBUZZ);
    let shapedFace = shapedFaces.get(font);
    if (!shapedFace) {
      shapedFace = shaper.face(font.bytes);
      shapedFaces.set(font, shapedFace);
    }
    return shapedFace.shape(text, rtl);
  }

  function width(run: TextRun, size: number): number {
    // Unknown system glyphs: a full em each leaves room for the widest of them.
    if (!run.font) return [...run.text].length * size;
    const advances = run.font.shaped
      ? shape(run.font, run.text, RTL_TEXT.test(run.text)).map((glyph) => glyph.xAdvance)
      : run.font.font.layout(run.text, FEATURES).positions.map((position) => position.xAdvance);
    return advances.reduce((sum, advance) => sum + advance, 0) * (size / run.font.font.unitsPerEm);
  }

  /** Whether the built-in serif faces draw this figure: for `font: "serif"`, or a serif `font` family. */
  function fallbackSerif(options?: Layout): boolean {
    if (!options?.custom) return options?.font === "serif";
    return (options.fontFallback ?? (options.custom.serif ? "serif" : "sans")) === "serif";
  }

  function textRuns(text: string, options?: Layout, unavailable?: Set<FontSource>): TextRun[] {
    const serif = fallbackSerif(options);
    const [sansOrSerif, japanese, chinese] = serif ? SOURCES.slice(3) : SOURCES.slice(0, 3);
    const latin = options?.custom ? [options.custom, sansOrSerif] : [sansOrSerif];
    const locale = options?.locale?.toLowerCase() ?? "";
    const normalized = text.normalize("NFC");
    // Han is shared by Japanese and Chinese: kana or a Japanese locale selects Japanese glyph forms.
    const cjk =
      /^ja\b/.test(locale) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)
        ? [japanese, chinese]
        : [chinese, japanese];
    // Chinese typesets quotes, dashes and ellipses beside Han at full width, as its own face draws them.
    const cjkPunctuation = /^zh\b/.test(locale) && /\p{Script=Han}/u.test(normalized);
    // Without HarfBuzz, no complex-script face can be laid out.
    // Without the subsetter, no face can be embedded.
    const isUnavailable = (source: FontSource | undefined) =>
      source !== undefined &&
      (unavailable?.has(source) === true ||
        unavailable?.has(SUBSETTER) === true ||
        (source.shaped === true && unavailable?.has(HARFBUZZ) === true));
    const runs: TextRun[] = [];
    const missing = new Set<string>();
    for (const { 0: character, index } of normalized.matchAll(/./gsu)) {
      const codePoint = character.codePointAt(0) ?? 0;
      const previous = runs.at(-1);
      // A keycap (1️⃣) is a digit, #, or * the emoji face composes with the marks that follow it.
      const keycap = KEYCAP.test(normalized.slice(index));
      // Marks, joiners and selectors belong to the run before them; so do spaces, digits and punctuation
      // inside a complex-script run (not emoji), which then shapes, and reads right to left, as one.
      if (
        previous?.font &&
        !keycap &&
        (/\p{Script=Inherited}/u.test(character)
          ? // HarfBuzz consumes joiners and selectors; any other mark needs a glyph, or PDF draws .notdef.
            previous.font.font.hasGlyphForCodePoint(codePoint) ||
            (previous.font.shaped && /\p{Default_Ignorable_Code_Point}/u.test(character))
          : /\p{Script=Common}/u.test(character) &&
            previous.font.shaped &&
            previous.font.family !== EMOJI.family &&
            previous.font.font.hasGlyphForCodePoint(codePoint))
      ) {
        previous.text += character;
        continue;
      }
      const chinesePunctuation = cjkPunctuation && codePoint > 0x7f && /\p{P}/u.test(character);
      const faces = keycap ? undefined : SCRIPT_FACES.find(([pattern]) => pattern.test(character));
      const script = keycap ? EMOJI : faces?.[serif ? 2 : 1];
      // Emoji last: a text-default symbol (❤, ☺, ✌) keeps its text glyph where another face has one.
      const order = [
        ...(script ? [script] : []),
        // A serif script face lacking a character its sans twin has (Noto Serif Oriya's U+0B55) falls back to it.
        ...(faces && faces[1] !== script ? [faces[1]] : []),
        ...(chinesePunctuation ? [...cjk, ...latin] : [...latin, ...cjk]),
        ...(script === EMOJI ? [] : [EMOJI]),
      ];
      // The face meant for this character. When it is unavailable, another face would draw the text in the
      // wrong forms (Chinese Han for Japanese, CJK Latin for Latin), so it becomes a system-font run instead.
      const designated = script ?? (chinesePunctuation || CJK_TEXT.test(character) ? cjk[0] : latin[0]);
      let font: FigureFont | undefined;
      let skipped = isUnavailable(designated);
      // In order, so a face loads only when every face before it lacks the character.
      for (const source of skipped ? [] : order) {
        if (isUnavailable(source)) {
          skipped = true;
          continue;
        }
        const candidate = face(source);
        if (!candidate.font.hasGlyphForCodePoint(codePoint)) continue;
        // Measuring a complex-script run needs HarfBuzz, so load it with the face.
        if (candidate.shaped && !shaper) throw new UnloadedFace(HARFBUZZ);
        font = candidate;
        break;
      }
      if (!font && !skipped && options?.fallback !== "system") {
        missing.add(character);
        continue;
      }
      if (previous && previous.font === font) previous.text += character;
      else runs.push({ text: character, font });
    }
    if (missing.size) throw new FigureFontError([...missing].join(""));
    return runs;
  }

  function layoutSvg(authors: Author[], options?: Layout, unavailable?: Set<FontSource>): string {
    return buildHeatmapSvg(authors, {
      ...options,
      // The system font stack for text no face draws.
      font: fallbackSerif(options) ? "serif" : "sans",
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

  /**
   * A label's runs in drawing order, left to right. A right-to-left complex-script run keeps its logical text,
   * since HarfBuzz returns its glyphs in visual order; a Latin or CJK run inside it, such as a bracket, is
   * mirrored and reversed. Labels with no right-to-left letters skip the bidi algorithm.
   */
  async function visualRuns(runs: TextRun[]): Promise<(TextRun & { rtl: boolean })[]> {
    const text = runs.map((run) => run.text).join("");
    if (!RTL_TEXT.test(text)) return runs.map((run) => ({ ...run, rtl: false }));
    const bidi = (await import("bidi-js")).default();
    // Left to right as the base, as SVG <text> has by default, so both formats order a mixed label alike.
    // bidi-js classes each UTF-16 unit alone, so an astral emoji's surrogates would count as strong
    // left-to-right letters; an object replacement character of the same length keeps it neutral.
    const classified = text.replace(/(?![\p{L}\p{N}])[\u{10000}-\u{10ffff}]/gu, "\ufffc\ufffc");
    const { levels } = bidi.getEmbeddingLevels(classified, "ltr");
    // Split each run where the embedding level changes, then reverse each sequence at or above every odd level.
    const pieces: (TextRun & { level: number })[] = [];
    let index = 0;
    for (const run of runs) {
      for (const unit of run.text.match(/[\s\S]/gu) ?? []) {
        const level = levels[index] ?? 0;
        index += unit.length;
        const last = pieces.at(-1);
        if (last && last.font === run.font && last.level === level) last.text += unit;
        else pieces.push({ text: unit, font: run.font, level });
      }
    }
    const highest = Math.max(...pieces.map((piece) => piece.level));
    const lowestOdd = Math.min(...pieces.map((piece) => piece.level).filter((level) => level % 2));
    for (let level = highest; level >= lowestOdd; level--)
      for (let first = 0; first < pieces.length; first++) {
        if ((pieces[first]?.level ?? 0) < level) continue;
        let last = first;
        while (last + 1 < pieces.length && (pieces[last + 1]?.level ?? 0) >= level) last++;
        pieces.splice(first, last - first + 1, ...pieces.slice(first, last + 1).reverse());
        first = last;
      }
    return pieces.map(({ text: piece, font, level }) => {
      const rtl = level % 2 === 1;
      // HarfBuzz reverses a shaped run itself; a fontkit run is drawn as given, so reverse and mirror it here.
      const drawn =
        rtl && !font?.shaped
          ? [...piece]
              .reverse()
              .map((character) => bidi.getMirroredCharacter(character) ?? character)
              .join("")
          : piece;
      return { text: drawn, font, rtl };
    });
  }

  return {
    async svg(authors, options) {
      const layout: Layout = { ...options, custom: await customFont(options) };
      const used = new Map<FigureFont, Set<string>>();
      const unavailable = new Set<FontSource>();
      const svg = await withFaces(() => {
        used.clear();
        const drawn = layoutSvg(authors, layout, unavailable).replace(
          /<text\b([^>]*)>([^<]*)<\/text>/g,
          (_, attrs: string, text: string) => {
            const system = attrs.match(/ font-family="([^"]*)"/)?.[1] ?? "sans-serif";
            const content = textRuns(unescapeXml(text), layout, unavailable)
              .map((run) => {
                if (!run.font) return `<tspan font-family="${system}">${escapeXml(run.text)}</tspan>`;
                const characters = used.get(run.font) ?? new Set<string>();
                for (const character of run.text) characters.add(character);
                used.set(run.font, characters);
                return `<tspan font-family="${cssFamily(run.font.family)}">${escapeXml(run.text)}</tspan>`;
              })
              .join("");
            const ownAttrs = attrs.replace(/ font-family="[^"]*"/, "").replace(/ font-weight="[^"]*"/, "");
            return `<text${ownAttrs} xml:space="preserve">${content}</text>`;
          },
        );
        if (!subsetter && [...used.keys()].some((font) => !font.noSubset)) throw new UnloadedFace(SUBSETTER);
        return drawn;
      }, unavailable);
      const faces = [...used].map(([font, characters]) => {
        const bytes = embeddable(font, characters, false);
        const type = String.fromCharCode(...bytes.subarray(0, 4)) === "OTTO" ? "otf" : "ttf";
        return `@font-face{font-family:${cssFamily(font.family)};src:url('data:font/${type};base64,${base64(bytes)}');font-weight:400}`;
      });
      return svg.replace(
        /(<svg\b[^>]*>)/,
        `$1\n<style>${faces.join("")}text{font-kerning:none;font-variant-ligatures:none}</style>`,
      );
    },

    async pdf(authors, options, widthMm) {
      if (widthMm !== undefined && (!Number.isFinite(widthMm) || widthMm <= 0))
        throw new RangeError("Figure width must be a positive finite number of millimeters.");
      const strict: Layout = { ...options, custom: await customFont(options), fallback: "error" };
      const svg = await withFaces(() => {
        const layout = layoutSvg(authors, strict);
        for (const [, text] of layout.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g))
          textRuns(unescapeXml(text ?? ""), strict);
        return layout;
      });
      // Each label's runs, and each face's drawn characters (mirrored brackets included), so a face is
      // subset before pdf-lib embeds it.
      const labels = new Map<string, (TextRun & { rtl: boolean })[]>();
      const used = new Map<FigureFont, Set<string>>();
      for (const [, text = ""] of svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)) {
        const runs = await visualRuns(textRuns(unescapeXml(text), strict));
        labels.set(text, runs);
        for (const { font, text: drawn } of runs)
          if (font) used.set(font, new Set([...(used.get(font) ?? []), ...drawn]));
      }
      if ([...used.keys()].some((font) => !font.noSubset)) await load(SUBSETTER);
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
      const openType: PDFFont[] = [];
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

        const runs = labels.get(match[4] ?? "") ?? [];
        const size = Number(attrs["font-size"]);
        const transform = attrs.transform?.match(/^translate\(([^,]+),([^)]+)\) rotate\(([^)]+)\)$/);
        const originX = transform ? Number(transform[1]) : x;
        const originY = transform ? Number(transform[2]) : y;
        const angle = transform ? -Number(transform[3]) : 0;
        const radians = (angle * Math.PI) / 180;
        const fill = color(attrs.fill) ?? rgb(0, 0, 0);
        let advance = attrs["text-anchor"] === "end" ? -runs.reduce((sum, run) => sum + width(run, size), 0) : 0;
        /**
         * Draw glyphs one by one from `advance`, so mark offsets survive; pdf-lib's drawText drops them. A glyph
         * with `text` opens a marked span whose ActualText is the characters it and the following glyphs drew.
         */
        const drawGlyphs = (
          key: PDFName,
          unit: number,
          glyphs: {
            code: string;
            position: Pick<ShapedGlyph, "xAdvance" | "yAdvance" | "xOffset" | "yOffset">;
            text?: string;
          }[],
          rightToLeft = false,
        ) => {
          let penX = advance;
          let penY = 0;
          let open = false;
          const placed = glyphs.map((glyph) => {
            const at = { ...glyph, x: penX, y: penY };
            penX += glyph.position.xAdvance * unit;
            penY += glyph.position.yAdvance * unit;
            return at;
          });
          // Right to left: draw the rightmost glyph first, so the content stream runs in reading order, which
          // MuPDF needs to apply the ActualText the right way round.
          if (rightToLeft) placed.reverse();
          for (const { code, position, text, x: glyphX, y: glyphY } of placed) {
            if (text !== undefined) {
              if (open) page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
              page.pushOperators(
                PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
                  PDFName.of("Span"),
                  // pdf-lib's operator types omit dictionaries, which BDC takes inline and serializes as written.
                  document.context.obj({ ActualText: PDFHexString.fromText(text) }) as unknown as PDFName,
                ]),
              );
              open = true;
            }
            const offsetX = glyphX + position.xOffset * unit;
            const offsetY = glyphY + position.yOffset * unit;
            page.pushOperators(
              ...drawText(PDFHexString.of(code), {
                x: originX + offsetX * Math.cos(radians) - offsetY * Math.sin(radians),
                y: pageHeight - originY + offsetX * Math.sin(radians) + offsetY * Math.cos(radians),
                size,
                font: key,
                color: fill,
                rotate: degrees(angle),
                xSkew: degrees(0),
                ySkew: degrees(0),
              }),
            );
          }
          if (open) page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
        };
        for (const run of runs) {
          const runFace = run.font;
          if (!runFace) throw new FigureFontError(run.text);
          let font = embedded.get(runFace);
          if (!font) {
            const bytes = embeddable(runFace, used.get(runFace) ?? [], true);
            // Subset here with every glyph id kept, so HarfBuzz's ids (drawn with Identity-H) and pdf-lib's own
            // encoding of the whole face stay valid; pdf-lib then embeds these bytes as they are.
            font = await document.embedFont(bytes, {
              subset: false,
              features: FEATURES,
              // The six-letter tag marks a subset, by PDF convention.
              customName: runFace.noSubset
                ? (runFace.font.postscriptName ?? undefined)
                : `CMFIGR+${runFace.font.postscriptName}`,
            });
            embedded.set(runFace, font);
            if (String.fromCharCode(...bytes.subarray(0, 4)) === "OTTO") {
              // As CIDFontType0, a viewer maps each code through the CFF charset (CID to glyph), but the codes
              // are glyph ids: a CID-keyed font whose CIDs are not its glyph ids would draw the wrong glyphs.
              const problem = cffProblem(bytes);
              if (problem)
                throw new FigureFontFileError(
                  `${runFace.family} ${problem}, which PDF figures cannot embed. Install its TrueType (.ttf) build.`,
                );
              openType.push(font);
            }
          }
          const unit = size / runFace.font.unitsPerEm;
          if (runFace.shaped) {
            // Shaped glyphs do not map one to one to letters (reordered marks, shared bases, ligatures), so the
            // run carries its letters as ActualText.
            const glyphs = shape(runFace, run.text, run.rtl);
            drawGlyphs(
              page.node.newFontDictionary(font.name, font.ref),
              unit,
              glyphs.map(({ id, ...position }, index) => ({
                code: id.toString(16).padStart(4, "0"),
                position,
                text: index === (run.rtl ? glyphs.length - 1 : 0) ? run.text : undefined,
              })),
              run.rtl,
            );
            advance += width(run, size);
            continue;
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
            // Encode first to retain the subset's glyph ids and Unicode mapping.
            const codes = font.encodeText(run.text).asString().match(/.{4}/g) ?? [];
            if (codes.length !== layout.positions.length)
              throw new Error("Figure glyph layout and PDF encoding do not match.");
            drawGlyphs(
              page.node.newFontDictionary(font.name, font.ref),
              unit,
              layout.positions.map((position, index) => ({ code: codes[index] ?? "0000", position })),
            );
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
      // fontkit 1.1.1 never reports a CFF table, so pdf-lib declares a CFF-flavored OpenType file a TrueType
      // one (CIDFontType2, FontFile2). Relabel it as PDF 1.6 does: CIDFontType0, FontFile3 /OpenType.
      // Embedding now, after the last glyph is drawn, is final.
      for (const font of openType) {
        await font.embed();
        const cid = document.context
          .lookup(font.ref, PDFDict)
          .lookup(PDFName.of("DescendantFonts"), PDFArray)
          .lookup(0, PDFDict);
        cid.set(PDFName.of("Subtype"), PDFName.of("CIDFontType0"));
        cid.delete(PDFName.of("CIDToGIDMap"));
        const descriptor = cid.lookup(PDFName.of("FontDescriptor"), PDFDict);
        const file = descriptor.get(PDFName.of("FontFile2"));
        if (!file) throw new Error("pdf-lib embedded an OpenType figure font without its font file.");
        descriptor.delete(PDFName.of("FontFile2"));
        descriptor.set(PDFName.of("FontFile3"), file);
        descriptor.lookup(PDFName.of("FontFile3"), PDFStream).dict.set(PDFName.of("Subtype"), PDFName.of("OpenType"));
      }
      // SVG pixels are 1/96 inch; PDF points are 1/72 inch. Keep their natural print sizes equal.
      const printScale = widthMm === undefined ? 0.75 : (widthMm * 72) / (25.4 * pageWidth);
      page.scaleContent(printScale, printScale);
      page.setSize(pageWidth * printScale, pageHeight * printScale);
      return document.save();
    },
  };
}

/** Why an OTTO font cannot go into a PDF figure, or undefined. Read from the bytes: fontkit 1.1.1 often cannot. */
function cffProblem(font: Uint8Array): string | undefined {
  try {
    const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
    const tables = new Map<number, number>();
    for (let record = 12; record < 12 + view.getUint16(4) * 16; record += 16)
      tables.set(view.getUint32(record), view.getUint32(record + 8));
    // pdf-lib's embed and the CIDFontType0 relabel assume CFF; viewers do not draw CFF2 in a PDF.
    if (tables.has(0x43464632)) return "is a CFF2 (variable OpenType) font";
    const at = tables.get(0x43464620);
    if (at === undefined) return "has no CFF table";
    return cidsAreGlyphIds(font, view, at) ? undefined : "is a CID-keyed font whose CIDs differ from its glyph ids";
  } catch {
    return "has a CFF table that cannot be read";
  }
}

/** Whether the CFF table at `at` maps every glyph id to the same CID; name-keyed CFF has no CIDs and passes. */
function cidsAreGlyphIds(font: Uint8Array, view: DataView, at: number): boolean {
  const byte = (offset: number) => view.getUint8(at + offset);
  const u16 = (offset: number) => view.getUint16(at + offset);
  const sized = (offset: number, size: number) => {
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + byte(offset + i);
    return value;
  };
  // A CFF INDEX: a count, an offset size, count + 1 offsets (from 1), then the data.
  const index = (offset: number) => {
    const count = u16(offset);
    if (count === 0) return { count, items: [] as [number, number][], end: offset + 2 };
    const size = byte(offset + 2);
    const data = offset + 2 + (count + 1) * size;
    const items: [number, number][] = [];
    for (let i = 0; i < count; i++)
      items.push([data + sized(offset + 3 + i * size, size), data + sized(offset + 3 + (i + 1) * size, size)]);
    return { count, items, end: data + sized(offset + 3 + count * size, size) };
  };
  const names = index(byte(2));
  const [top] = index(names.end).items;
  if (!top) return false;
  // The Top DICT's operands come before their operator; only the integer ones matter here.
  const dict = new Map<number, number[]>();
  let operands: number[] = [];
  for (let i = top[0]; i < top[1]; ) {
    const b = byte(i);
    if (b <= 21) {
      const operator = b === 12 ? 1200 + byte(i + 1) : b;
      i += b === 12 ? 2 : 1;
      dict.set(operator, operands);
      operands = [];
    } else if (b === 28) {
      operands.push(view.getInt16(at + i + 1));
      i += 3;
    } else if (b === 29) {
      operands.push(view.getInt32(at + i + 1));
      i += 5;
    } else if (b === 30) {
      i += 1;
      while ((byte(i) & 0x0f) !== 0x0f && (byte(i) & 0xf0) !== 0xf0) i++;
      i += 1;
      operands.push(0);
    } else if (b <= 246) {
      operands.push(b - 139);
      i += 1;
    } else {
      const sign = b <= 250 ? 1 : -1;
      operands.push(sign * ((b - (b <= 250 ? 247 : 251)) * 256 + byte(i + 1) + 108));
      i += 2;
    }
  }
  // ROS (12 30) marks a CID-keyed font.
  if (!dict.has(1230)) return true;
  const charset = dict.get(15)?.[0] ?? 0;
  const glyphs = index(dict.get(17)?.[0] ?? 0).count;
  if (charset <= 2) return false;
  const format = byte(charset);
  let glyph = 1;
  // Format 0 lists each glyph's CID from glyph 1; formats 1 and 2 list ranges of consecutive CIDs.
  for (let p = charset + 1; glyph < glyphs; ) {
    const first = u16(p);
    if (first !== glyph) return false;
    if (format === 0) {
      glyph += 1;
      p += 2;
    } else {
      const left = format === 1 ? byte(p + 2) : u16(p + 2);
      glyph += left + 1;
      p += format === 1 ? 3 : 4;
    }
  }
  return true;
}
