import type { Author } from "../author";
import { rolesWithContributions } from "../author";
import { DEFAULT_MONO_COLOR, heatCellColor, onColor } from "../contributor-color";
import type { RoleTranslator } from "../credit-i18n/index";
import { makeUiTranslator, type UiTranslator } from "../credit-i18n/ui-strings";
import { CREDIT_ROLES } from "../credit-roles";
import { generateStatement } from "../generate-statement";
import { escapeXml } from "./escape-xml";
import { GENERATOR_NOTE } from "./generator-note";

// Layout constants (unscaled)
const CELL = 22;
const GAP = 2;
const PAD = 24;
/** Breathing room between a label and the grid edge it annotates. */
const LABEL_GAP = 6;
/** Grid bottom to the top of the legend's first row. */
const LEGEND_GAP = 18;
const SWATCH = 14;
/** Trailing space after a legend item, before the next one on the same row. */
const LEGEND_ITEM_GAP = 20;
const LEGEND_ROW_H = 20;
const FONT = "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";
const FONT_TOP = 11;
const FONT_LEFT = 10.5;
const FONT_LEGEND = 10;
/** Approximate advance width per Latin character, as a fraction of the em. */
const CHAR_EM = 0.62;
/** A -45° label's reach along either axis, per unit of its own length. */
const DIAG = Math.SQRT1_2;

// Ink-on-paper neutrals (matching the UI identity)
const COLOR_TEXT = "#16181c";
const COLOR_TEXT_DIM = "#595c63";
const COLOR_BG = "#ffffff";
const COLOR_BORDER = "#c9c9c5";

export class HeatmapOptionError extends Error {}

export interface HeatmapSvgOptions {
  /** Named sequential palette; color overrides its base hue. */
  palette?: "blue" | "green" | "gray";
  /** Base hue for the heatmap; defaults to the palette's. */
  color?: string;
  shape?: "square" | "rounded" | "circle";
  /** Cell side in SVG pixels (Typst uses points). */
  size?: number;
  legend?: boolean;
  /** Place the key beside a narrow tall matrix or below a wide one. Defaults to auto. */
  legendPosition?: "auto" | "right" | "bottom";
  /** Add redundant dots/checks in cells and the key. Defaults to false. */
  marks?: boolean;
  /** Base label size in SVG pixels, from 6 to 32. Defaults to 10.5. */
  fontSize?: number;
  /** Portable font stack. Defaults to sans. */
  font?: "sans" | "serif";
  /** Short labels pair the role number with twelve characters; the text alternative retains full names. */
  labels?: "full" | "short";
  /**
   * Grade cell fills by contribution level. When false, fills are flat
   * (contributed/none) and the legend collapses to two keys. Defaults to true.
   */
  levels?: boolean;
  /** Swap axes: authors down the left, roles across the top. */
  horizontal?: boolean;
  skipempty?: boolean;
  /** @deprecated Use `color`. */
  monoColor?: string;
  /** @deprecated Use `horizontal`. */
  transpose?: boolean;
  /** @deprecated Use `levels`. */
  showLevels?: boolean;
  /**
   * Label authors by their initials (true) or full names (false) on the axis.
   * Defaults to true. The text alternative retains full names.
   */
  acronyms?: boolean;
  /** Scale all layout dimensions (min 0.1). */
  scale?: number;
  /** Localize displayed role names. Defaults to identity; lookups stay canonical English. */
  translateRole?: RoleTranslator;
  /** Localize the level legend and empty-state line. Defaults to English. */
  translateUi?: UiTranslator;
  /**
   * BCP-47 locale of the `<desc>` statement's name lists. Defaults to "en".
   * When set, it is also the root element's `xml:lang` and `lang`, so a screen
   * reader reads `<title>` and `<desc>` in that language.
   */
  locale?: string;
  /** Measure a label in SVG pixels at the given font size, before scale. */
  measureText?: (label: string, fontSize: number) => number;
  /** Measure a label's line height in SVG pixels at the given font size, before scale. */
  measureTextHeight?: (label: string, fontSize: number) => number;
}

/**
 * The heatmap's text alternative: the by-author contribution statement, in the
 * same language and with the same levels as the figure. The SVG carries it as
 * `<desc>`; a PNG export can carry it as a Description text chunk.
 */
export function heatmapDescription(authors: Author[], opts?: HeatmapSvgOptions): string {
  return generateStatement(authors, {
    format: "by-author",
    showLevels: opts?.levels ?? opts?.showLevels ?? true,
    translateRole: opts?.translateRole,
    translateUi: opts?.translateUi,
    locale: opts?.locale,
  });
}

/**
 * Render a contribution heatmap as a self-contained SVG string.
 *
 * Pure and dependency-free. Runs in the browser (for live preview, SVG
 * download, and canvas→PNG export) and in Node (for tests). The SVG uses
 * font stacks; exact glyphs depend on the installed fonts.
 *
 * Label bands use estimated text widths. The key fits beside tall narrow grids
 * or wraps below wider ones, with explicit placement overrides.
 * Roles that no author contributed to are
 * omitted by default. There is no *rendered* image title:
 * captions belong to the embedding document. The `<title>` element is the
 * accessible name for the `role="img"` graphic and `<desc>` its text
 * alternative: the by-author contribution statement, so a screen reader hears
 * who did what. Assistive technology reads both and nothing draws them.
 */
export function buildHeatmapSvg(authors: Author[], opts?: HeatmapSvgOptions): string {
  const transpose = opts?.horizontal ?? !!opts?.transpose;
  const scale = typeof opts?.scale === "number" ? Math.max(0.1, opts.scale) : 1;
  if (!Number.isFinite(scale)) throw new HeatmapOptionError("Heatmap scale must be finite.");
  const palettes = { blue: DEFAULT_MONO_COLOR, green: "#00724c", gray: "#404040" };
  if (opts?.palette && !Object.hasOwn(palettes, opts.palette)) throw new HeatmapOptionError("Unknown heatmap palette.");
  const monoColor = opts?.color ?? opts?.monoColor ?? palettes[opts?.palette ?? "blue"];
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(monoColor))
    throw new HeatmapOptionError("Heatmap color must be a three- or six-digit hex color.");
  const size = opts?.size ?? CELL;
  if (!Number.isFinite(size) || size <= 0 || size > 256)
    throw new HeatmapOptionError("Heatmap size must be between 0 and 256.");
  const shape = opts?.shape ?? "square";
  const legendPosition = opts?.legendPosition ?? "auto";
  if (!["auto", "right", "bottom"].includes(legendPosition))
    throw new HeatmapOptionError("Unknown heatmap legend position.");
  if (opts?.marks !== undefined && typeof opts.marks !== "boolean")
    throw new HeatmapOptionError("Heatmap marks must be a boolean.");
  if (!["square", "rounded", "circle"].includes(shape)) throw new HeatmapOptionError("Unknown heatmap shape.");
  if (opts?.labels && !["full", "short"].includes(opts.labels)) throw new HeatmapOptionError("Unknown heatmap labels.");
  const fontSize = opts?.fontSize ?? FONT_LEFT;
  if (!Number.isFinite(fontSize) || fontSize < 6 || fontSize > 32)
    throw new HeatmapOptionError("Heatmap font size must be between 6 and 32.");
  const font = opts?.font ?? "sans";
  if (!["sans", "serif"].includes(font)) throw new HeatmapOptionError("Unknown heatmap font.");
  const fontFamily = font === "serif" ? "Georgia, 'Times New Roman', serif" : FONT;
  const fontRatio = fontSize / FONT_LEFT;
  const fontTop = FONT_TOP * fontRatio;
  const fontLeft = fontSize;
  const fontLegend = FONT_LEGEND * fontRatio;
  const radius = (side: number) => (shape === "circle" ? side / 2 : shape === "rounded" ? 3 * scale : 0);
  const showLevels = opts?.levels ?? opts?.showLevels ?? true;
  const translateRole = opts?.translateRole ?? ((name: string) => name);
  const translateUi = opts?.translateUi ?? makeUiTranslator(null);
  const acronyms = opts?.acronyms ?? true;
  const lang = opts?.locale ? ` xml:lang="${escapeXml(opts.locale)}" lang="${escapeXml(opts.locale)}"` : "";
  const authorLabel = (ai: number): string =>
    (acronyms ? authors[ai]?.initials : authors[ai]?.name) ?? authors[ai]?.initials ?? "";

  // By default, omit roles nobody contributed to.
  const activeRoleNames = new Set(rolesWithContributions(authors));
  const roles = CREDIT_ROLES.filter((r) => opts?.skipempty === false || activeRoleNames.has(r.name));
  const roleLabel = (name: string) => {
    const label = translateRole(name);
    return opts?.labels === "short"
      ? `${CREDIT_ROLES.findIndex((r) => r.name === name) + 1} ${[...label].slice(0, 12).join("")}${[...label].length > 12 ? "…" : ""}`
      : label;
  };

  const PAD_S = PAD * scale;

  // Approx rendered width of a label. CJK glyphs render full-width (≈1em)
  // against a Latin advance of ≈0.62em, so count them as 1.6 units or a
  // six-character Japanese name overflows its band.
  // Escapes, not literals: the compat-ideograph block starts at U+F900, whose
  // glyph is indistinguishable from U+8C48 in a source file, and the lookalike
  // silently widened the range across everything up to U+FAFF.
  // Jamo · CJK radicals through Yi · Hangul syllables · compat ideographs ·
  // vertical/compat punctuation · full-width forms.
  const CJK_CHAR = /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;
  const labelUnits = (label: string): number =>
    [...label].reduce((units, char) => units + (CJK_CHAR.test(char) ? 1.6 : 1), 0);
  const textW = (label: string, labelSize: number): number =>
    (opts?.measureText?.(label, labelSize) ?? labelUnits(label) * labelSize * CHAR_EM) * scale;
  const textH = (label: string, labelSize: number): number =>
    opts?.measureTextHeight?.(label, labelSize) ?? labelSize * 1.2;
  // Conservative glyph bounds prevent wide capitals and rotated ascenders from clipping.
  const safeTextW = (label: string, labelSize: number): number =>
    Math.max(
      textW(label, labelSize),
      [...label].reduce(
        (width, char) =>
          width + (CJK_CHAR.test(char) || /[MWmw@%&]/u.test(char) ? 1 : /\p{Lu}/u.test(char) ? 0.8 : CHAR_EM),
        0,
      ) *
        labelSize *
        scale,
    );

  // Nothing to show: render a small placeholder rather than a 0-row grid.
  if (roles.length === 0 || authors.length === 0) {
    const message = translateUi("emptyState");
    const extraFontHeight = Math.max(0, fontTop - FONT_TOP);
    const w = Math.max(320 * scale, PAD_S * 2 + Math.max(textW(message, fontTop), safeTextW(message, fontTop)));
    const h = (56 + extraFontHeight * 1.2) * scale;
    const baseline = (PAD + 8 + extraFontHeight) * scale;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"${lang}>`,
      `<!-- ${GENERATOR_NOTE} -->`,
      `<title>${escapeXml(translateUi("heatmapTitle"))}</title>`,
      `<rect width="${w}" height="${h}" fill="${COLOR_BG}"/>`,
      `<text x="${PAD_S}" y="${baseline}" font-family="${fontFamily}" font-size="${fontTop * scale}" fill="${COLOR_TEXT_DIM}">${escapeXml(message)}</text>`,
      "</svg>",
    ].join("\n");
  }

  const nAuthors = authors.length;
  const nRoles = roles.length;

  const scoreFor = (author: Author | undefined, roleName: string): number =>
    author?.contributions.find((c) => c.role === roleName)?.score ?? 0;
  // Flat mode collapses any contribution to full intensity.
  const fillScore = (score: number): number => (showLevels ? score : score > 0 ? 100 : 0);
  // A figure has four fills; parsing colors and measuring contrast per cell is costly.
  const tierColor = (score: number) => {
    const fill = heatCellColor(monoColor, score);
    return { fill, ink: opts?.marks ? onColor(fill) : "" };
  };
  const tierColors = [tierColor(0), tierColor(33), tierColor(66), tierColor(100)] as const;
  const colorsFor = (score: number) => tierColors[score <= 0 ? 0 : score <= 33 ? 1 : score <= 66 ? 2 : 3];

  const CELL_S = size * scale;
  const LABEL_GAP_S = LABEL_GAP * scale;

  // Top labels (rotated -45°): author labels when normal, role names when transposed.
  const topLabels = transpose ? roles.map((r) => roleLabel(r.name)) : authors.map((_, ai) => authorLabel(ai));
  // Left labels (horizontal, right-aligned): roles when normal, authors when transposed.
  const leftLabels = transpose ? authors.map((_, ai) => authorLabel(ai)) : roles.map((r) => roleLabel(r.name));
  // A 45° header needs sqrt(2) times its actual line height between columns.
  const topHeight = Math.max(...topLabels.map((label) => textH(label, fontTop)));
  const leftHeight = Math.max(...leftLabels.map((label) => textH(label, fontLeft)));
  const COL_GAP_S = Math.max(GAP, topHeight * Math.SQRT2 - size) * scale;
  const ROW_GAP_S = Math.max(GAP, leftHeight - size) * scale;

  const topLabelWs = topLabels.map((l) => textW(l, fontTop));
  const maxTopW = Math.max(0, ...topLabelWs);
  const maxLeftW = Math.max(0, ...leftLabels.map((l) => textW(l, fontLeft)));

  // Bands are the labels' own reach plus one gap — never a fixed frame. A
  // rotated label climbs by its length × cos45°; a horizontal one runs its
  // full length to the left.
  const safeTopReach = Math.max(
    0,
    ...topLabels.map((label) => (safeTextW(label, fontTop) + textH(label, fontTop) * scale) * DIAG),
  );
  const topBand = Math.max(maxTopW * DIAG + LABEL_GAP_S, safeTopReach + LABEL_GAP_S - PAD_S);
  const safeLeftW = Math.max(0, ...leftLabels.map((label) => safeTextW(label, fontLeft)));
  const leftBand = Math.max(maxLeftW + LABEL_GAP_S, safeLeftW + LABEL_GAP_S - PAD_S);
  // An earlier long header can reach farther right than the final short one.
  const rightOverhang = Math.max(
    0,
    ...topLabels.map((label, i) => {
      const remaining = (topLabels.length - 1 - i) * (CELL_S + COL_GAP_S);
      const safeW = safeTextW(label, fontTop) + textH(label, fontTop) * scale;
      return Math.max((topLabelWs[i] ?? 0) * DIAG, safeW * DIAG - PAD_S) - CELL_S / 2 - remaining;
    }),
  );

  const gridW = (transpose ? nRoles : nAuthors) * (CELL_S + COL_GAP_S) - COL_GAP_S;
  const gridH = (transpose ? nAuthors : nRoles) * (CELL_S + ROW_GAP_S) - ROW_GAP_S;

  const gridX = PAD_S + leftBand;
  const gridY = PAD_S + topBand;

  const levelKey: { label: string; score: number }[] = showLevels
    ? [
        { label: translateUi("lead"), score: 100 },
        { label: translateUi("equal"), score: 66 },
        { label: translateUi("supporting"), score: 33 },
        { label: translateUi("none"), score: 0 },
      ]
    : [
        { label: translateUi("contributed"), score: 100 },
        { label: translateUi("none"), score: 0 },
      ];

  // Measure both placements before choosing: a side key must not buy compactness
  // by making the whole figure excessively wide at its final print size.
  const SWATCH_S = SWATCH * scale;
  const LEGEND_ITEM_GAP_S = LEGEND_ITEM_GAP * scale;
  const legendItemW = (label: string) => SWATCH_S + 6 * scale + textW(label, fontLegend) + LEGEND_ITEM_GAP_S;
  const contentW = leftBand + gridW + rightOverhang;

  const legendItems = levelKey.map((key) => ({ ...key, w: legendItemW(key.label) }));
  const rowWidth = (row: { w: number }[]) => row.reduce((w, i) => w + i.w, 0) - LEGEND_ITEM_GAP_S;
  // Fewest rows that fit the figure, with the keys spread evenly across them:
  // four keys under a narrow grid read as 2×2, never as 3 and a widow.
  const chunk = (perRow: number) =>
    Array.from({ length: Math.ceil(legendItems.length / perRow) }, (_, i) =>
      legendItems.slice(i * perRow, i * perRow + perRow),
    );
  let legendRows = chunk(legendItems.length);
  for (let rows = 1; rows <= legendItems.length; rows++) {
    const candidate = chunk(Math.ceil(legendItems.length / rows));
    if (candidate.every((row) => rowWidth(row) <= contentW)) {
      legendRows = candidate;
      break;
    }
  }
  // Align the keys into columns, so a wrapped legend reads as one block rather
  // than as independently centred rows.
  const legendTextH = Math.max(...levelKey.map(({ label }) => textH(label, fontLegend)));
  const legendRowH = Math.max(LEGEND_ROW_H, fontLegend + 6, opts?.measureTextHeight ? legendTextH + 6 : 0) * scale;
  const swatchHeight = Math.max(SWATCH_S, legendTextH * scale);
  const bottomLegendCols = Math.max(...legendRows.map((row) => row.length));
  const bottomLegendW =
    Array.from({ length: bottomLegendCols }, (_, c) => Math.max(...legendRows.map((row) => row[c]?.w ?? 0))).reduce(
      (w, c) => w + c,
      0,
    ) - LEGEND_ITEM_GAP_S;
  const bottomW = PAD_S * 2 + Math.max(contentW, bottomLegendW);
  const bottomH = gridY + gridH + LEGEND_GAP * scale + (legendRows.length - 1) * legendRowH + swatchHeight + PAD_S;
  const sideLegendW = Math.max(...legendItems.map((item) => item.w)) - LEGEND_ITEM_GAP_S;
  const sideX = gridX + gridW + LEGEND_GAP * scale;
  const sideW = Math.max(PAD_S * 2 + contentW, sideX + sideLegendW + PAD_S);
  const sideH = gridY + Math.max(gridH, (legendItems.length - 1) * legendRowH + swatchHeight) + PAD_S;
  // At 48 em wide, an 85 mm figure retains a 5 pt legend.
  const autoWidthLimit = fontLegend * scale * 48;
  const rightLegend =
    legendPosition === "right" ||
    (legendPosition === "auto" &&
      gridH >= gridW * 1.5 &&
      sideW <= bottomW * 1.35 &&
      sideW <= autoWidthLimit &&
      sideH <= bottomH);
  if (rightLegend) legendRows = chunk(1);
  const legendCols = Math.max(...legendRows.map((row) => row.length));
  const colW = Array.from({ length: legendCols }, (_, c) => Math.max(...legendRows.map((row) => row[c]?.w ?? 0)));
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((x, w) => x + w, 0));
  const legendW = colW.reduce((w, c) => w + c, 0) - LEGEND_ITEM_GAP_S;
  const legendTop = rightLegend ? gridY : gridY + gridH + LEGEND_GAP * scale;
  const legendH = (legendRows.length - 1) * legendRowH + swatchHeight;

  const totalW =
    opts?.legend === false ? PAD_S * 2 + contentW : rightLegend ? sideW : PAD_S * 2 + Math.max(contentW, legendW);
  const totalH = (opts?.legend === false ? gridY + gridH : Math.max(gridY + gridH, legendTop + legendH)) + PAD_S;
  const innerW = totalW - PAD_S * 2;

  const lines: string[] = [];
  // The same dots and check as the editor keep the figure readable without colour.
  const mark = (x: number, y: number, side: number, score: number) => {
    if (!opts?.marks || score <= 0) return;
    const { ink } = colorsFor(fillScore(score));
    if (showLevels) {
      const dots = score <= 33 ? 1 : score <= 66 ? 2 : 3;
      const gap = side * 0.22;
      lines.push(`<g fill="${ink}" aria-hidden="true">`);
      for (let i = 0; i < dots; i++) {
        lines.push(
          `<circle cx="${x + side / 2 + (i - (dots - 1) / 2) * gap}" cy="${y + side / 2}" r="${side * 0.085}"/>`,
        );
      }
      lines.push("</g>");
    } else {
      lines.push(
        `<path d="M${x + side * 0.28},${y + side * 0.5} l${side * 0.15},${side * 0.15} l${side * 0.29},${-side * 0.3}" fill="none" stroke="${ink}" stroke-width="${side * 0.09}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"/>`,
      );
    }
  };
  const description = heatmapDescription(authors, opts);
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" role="img"${lang}>`,
    `<!-- ${GENERATOR_NOTE} -->`,
    `<title>${escapeXml(translateUi("heatmapTitle"))}</title>`,
    `<desc>${escapeXml(description)}</desc>`,
  );
  lines.push(`<rect width="${totalW}" height="${totalH}" fill="${COLOR_BG}"/>`);

  for (let i = 0; i < topLabels.length; i++) {
    const cx = gridX + i * (CELL_S + COL_GAP_S) + CELL_S / 2;
    const cy = gridY - LABEL_GAP_S;
    lines.push(
      `<text transform="translate(${cx},${cy}) rotate(-45)" text-anchor="start" font-family="${fontFamily}" font-size="${fontTop * scale}" font-weight="500" fill="${COLOR_TEXT}">${escapeXml(
        topLabels[i] ?? "",
      )}</text>`,
    );
  }

  // Rows: roles when normal, authors when transposed.
  const rowCount = transpose ? nAuthors : nRoles;
  for (let r = 0; r < rowCount; r++) {
    const cy = gridY + r * (CELL_S + ROW_GAP_S);
    lines.push(
      `<text x="${gridX - LABEL_GAP_S}" y="${cy + CELL_S / 2 + 4 * fontRatio * scale}" text-anchor="end" font-family="${fontFamily}" font-size="${fontLeft * scale}" fill="${COLOR_TEXT_DIM}">${escapeXml(
        leftLabels[r] ?? "",
      )}</text>`,
    );

    const colCount = transpose ? nRoles : nAuthors;
    for (let c = 0; c < colCount; c++) {
      const cx = gridX + c * (CELL_S + COL_GAP_S);
      const ai = transpose ? r : c;
      const role = transpose ? roles[c] : roles[r];
      const score = scoreFor(authors[ai], role?.name ?? "");
      const rx = radius(CELL_S);
      lines.push(
        `<rect x="${cx}" y="${cy}" width="${CELL_S}" height="${CELL_S}" rx="${rx}" ry="${rx}" fill="${colorsFor(fillScore(score)).fill}" stroke="${COLOR_BORDER}" stroke-width="${0.5 * scale}"/>`,
      );
      mark(cx, cy, CELL_S, score);
    }
  }

  // Grid border
  lines.push(
    `<rect x="${gridX - 1}" y="${gridY - 1}" width="${gridW + 2}" height="${gridH + 2}" rx="${radius(CELL_S)}" ry="${radius(CELL_S)}" fill="none" stroke="${COLOR_BORDER}" stroke-width="${0.5 * scale}"/>`,
  );

  // Legend: level keys, wrapped to the figure width and centred under it.
  (opts?.legend === false ? [] : legendRows).forEach((row, rowIndex) => {
    const y = legendTop + rowIndex * legendRowH;
    const blockX = rightLegend ? sideX : PAD_S + (innerW - legendW) / 2;
    for (const [col, { label, score }] of row.entries()) {
      const lx = blockX + (colX[col] ?? 0);
      lines.push(
        `<rect x="${lx}" y="${y}" width="${SWATCH_S}" height="${SWATCH_S}" rx="${radius(SWATCH_S)}" ry="${radius(SWATCH_S)}" fill="${colorsFor(score).fill}" stroke="${COLOR_BORDER}" stroke-width="${0.5 * scale}"/>`,
      );
      mark(lx, y, SWATCH_S, score);
      lines.push(
        `<text x="${lx + SWATCH_S + 4 * scale}" y="${y + SWATCH_S - 3 * scale + Math.max(0, fontLegend - FONT_LEGEND) * 0.8 * scale}" font-family="${fontFamily}" font-size="${fontLegend * scale}" fill="${COLOR_TEXT_DIM}">${escapeXml(label)}</text>`,
      );
    }
  });

  lines.push("</svg>");
  return lines.join("\n");
}
