import type { Author } from "../author";
import { rolesWithContributions } from "../author";
import { DEFAULT_MONO_COLOR, heatCellColor } from "../contributor-color";
import type { RoleTranslator } from "../credit-i18n/index";
import { makeUiTranslator, type UiTranslator } from "../credit-i18n/ui-strings";
import { CREDIT_ROLES } from "../credit-roles";
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
const COLOR_BG = "#fafaf9";
const COLOR_BORDER = "#e4e4e1";

export interface HeatmapSvgOptions {
  /** Base hue for the heatmap; defaults to the app accent. */
  monoColor?: string;
  /** Swap axes: authors down the left, roles across the top. */
  transpose?: boolean;
  /**
   * Grade cell fills by contribution level. When false, fills are flat
   * (contributed/none) and the legend collapses to two keys. Defaults to true.
   */
  showLevels?: boolean;
  /**
   * Label authors by their initials (true) or full names (false) on the axis.
   * Defaults to true. The legend always uses initials badges.
   */
  acronyms?: boolean;
  /** Scale all layout dimensions (min 0.1). */
  scale?: number;
  /** Localize displayed role names. Defaults to identity; lookups stay canonical English. */
  translateRole?: RoleTranslator;
  /** Localize the level legend and empty-state line. Defaults to English. */
  translateUi?: UiTranslator;
}

/**
 * Render a contribution heatmap as a self-contained SVG string.
 *
 * Pure and dependency-free. Runs in the browser (for live preview, SVG
 * download, and canvas→PNG export) and in Node (for tests). The SVG uses
 * system font stacks, so no font embedding is required.
 *
 * Every band is measured from the labels it actually carries, and the legend
 * wraps to the figure's own width, so the canvas is the drawing's bounding box
 * rather than a fixed frame around it: a two-author figure no longer inherits
 * the width of a four-key legend. Roles that no author contributed to are
 * omitted, matching the live chart. There is no *rendered* image title:
 * captions belong to the embedding document. The `<title>` element is the
 * accessible name for the `role="img"` graphic, which assistive technology
 * reads and nothing draws.
 */
export function buildHeatmapSvg(authors: Author[], opts?: HeatmapSvgOptions): string {
  const transpose = !!opts?.transpose;
  const scale = typeof opts?.scale === "number" ? Math.max(0.1, opts.scale) : 1;
  const monoColor = opts?.monoColor ?? DEFAULT_MONO_COLOR;
  const showLevels = opts?.showLevels ?? true;
  const translateRole = opts?.translateRole ?? ((name: string) => name);
  const translateUi = opts?.translateUi ?? makeUiTranslator(null);
  const acronyms = opts?.acronyms ?? true;
  const authorLabel = (ai: number): string =>
    (acronyms ? authors[ai]?.initials : authors[ai]?.name) ?? authors[ai]?.initials ?? "";

  // Only roles someone contributed to (matches the live chart).
  const activeRoleNames = new Set(rolesWithContributions(authors));
  const roles = CREDIT_ROLES.filter((r) => activeRoleNames.has(r.name));

  const PAD_S = PAD * scale;

  // Nothing to show: render a small placeholder rather than a 0-row grid.
  if (roles.length === 0) {
    const w = 320 * scale;
    const h = 56 * scale;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`,
      `<!-- ${GENERATOR_NOTE} -->`,
      `<title>${escapeXml(translateUi("heatmapTitle"))}</title>`,
      `<rect width="${w}" height="${h}" fill="${COLOR_BG}"/>`,
      `<text x="${PAD_S}" y="${PAD_S + 8}" font-family="${FONT}" font-size="${11 * scale}" fill="${COLOR_TEXT_DIM}">${escapeXml(translateUi("emptyState"))}</text>`,
      "</svg>",
    ].join("\n");
  }

  const nAuthors = authors.length;
  const nRoles = roles.length;

  const scoreFor = (author: Author | undefined, roleName: string): number =>
    author?.contributions.find((c) => c.role === roleName)?.score ?? 0;
  // Flat mode collapses any contribution to full intensity.
  const fillScore = (score: number): number => (showLevels ? score : score > 0 ? 100 : 0);

  const CELL_S = CELL * scale;
  const GAP_S = GAP * scale;
  const LABEL_GAP_S = LABEL_GAP * scale;

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
  const textW = (label: string, fontSize: number): number => labelUnits(label) * fontSize * CHAR_EM * scale;

  // Top labels (rotated -45°): author labels when normal, role names when transposed.
  const topLabels = transpose ? roles.map((r) => translateRole(r.name)) : authors.map((_, ai) => authorLabel(ai));
  // Left labels (horizontal, right-aligned): roles when normal, authors when transposed.
  const leftLabels = transpose ? authors.map((_, ai) => authorLabel(ai)) : roles.map((r) => translateRole(r.name));

  const topLabelWs = topLabels.map((l) => textW(l, FONT_TOP));
  const maxTopW = Math.max(0, ...topLabelWs);
  const maxLeftW = Math.max(0, ...leftLabels.map((l) => textW(l, FONT_LEFT)));

  // Bands are the labels' own reach plus one gap — never a fixed frame. A
  // rotated label climbs by its length × cos45°; a horizontal one runs its
  // full length to the left.
  const topBand = maxTopW * DIAG + LABEL_GAP_S;
  const leftBand = maxLeftW + LABEL_GAP_S;
  // Only the *last* top label crosses the grid's right edge, and only by the
  // part of its climb that clears the half-cell it starts from.
  const lastTopW = topLabelWs[topLabelWs.length - 1] ?? 0;
  const rightOverhang = Math.max(0, lastTopW * DIAG - CELL_S / 2);

  const gridW = (transpose ? nRoles : nAuthors) * (CELL_S + GAP_S) - GAP_S;
  const gridH = (transpose ? nAuthors : nRoles) * (CELL_S + GAP_S) - GAP_S;

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

  // Legend geometry: keys packed into rows no wider than the figure, so a
  // four-key legend under a two-column grid wraps instead of stretching the
  // canvas. Each row is centred on the canvas.
  const SWATCH_S = SWATCH * scale;
  const LEGEND_ITEM_GAP_S = LEGEND_ITEM_GAP * scale;
  const legendItemW = (label: string) => SWATCH_S + 6 * scale + textW(label, FONT_LEGEND) + LEGEND_ITEM_GAP_S;
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
  const legendCols = Math.max(...legendRows.map((row) => row.length));
  const colW = Array.from({ length: legendCols }, (_, c) => Math.max(...legendRows.map((row) => row[c]?.w ?? 0)));
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((x, w) => x + w, 0));
  const legendW = colW.reduce((w, c) => w + c, 0) - LEGEND_ITEM_GAP_S;
  const legendTop = gridY + gridH + LEGEND_GAP * scale;
  const legendH = legendRows.length * LEGEND_ROW_H * scale - (LEGEND_ROW_H * scale - SWATCH_S);

  const totalW = PAD_S * 2 + Math.max(contentW, legendW);
  const totalH = legendTop + legendH + PAD_S;
  const innerW = totalW - PAD_S * 2;

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" role="img">`,
    `<!-- ${GENERATOR_NOTE} -->`,
    `<title>${escapeXml(translateUi("heatmapTitle"))}</title>`,
  );
  lines.push(`<rect width="${totalW}" height="${totalH}" fill="${COLOR_BG}"/>`);

  for (let i = 0; i < topLabels.length; i++) {
    const cx = gridX + i * (CELL_S + GAP_S) + CELL_S / 2;
    const cy = gridY - LABEL_GAP_S;
    lines.push(
      `<text transform="translate(${cx},${cy}) rotate(-45)" text-anchor="start" font-family="${FONT}" font-size="${FONT_TOP * scale}" font-weight="500" fill="${COLOR_TEXT}">${escapeXml(
        topLabels[i] ?? "",
      )}</text>`,
    );
  }

  // Rows: roles when normal, authors when transposed.
  const rowCount = transpose ? nAuthors : nRoles;
  for (let r = 0; r < rowCount; r++) {
    const cy = gridY + r * (CELL_S + GAP_S);
    lines.push(
      `<text x="${gridX - LABEL_GAP_S}" y="${cy + CELL_S / 2 + 4 * scale}" text-anchor="end" font-family="${FONT}" font-size="${FONT_LEFT * scale}" fill="${COLOR_TEXT_DIM}">${escapeXml(
        leftLabels[r] ?? "",
      )}</text>`,
    );

    const colCount = transpose ? nRoles : nAuthors;
    for (let c = 0; c < colCount; c++) {
      const cx = gridX + c * (CELL_S + GAP_S);
      const ai = transpose ? r : c;
      const role = transpose ? roles[c] : roles[r];
      const score = scoreFor(authors[ai], role?.name ?? "");
      const rx = 3 * scale;
      lines.push(
        `<rect x="${cx}" y="${cy}" width="${CELL_S}" height="${CELL_S}" rx="${rx}" ry="${rx}" fill="${heatCellColor(monoColor, fillScore(score))}"/>`,
      );
    }
  }

  // Grid border
  lines.push(
    `<rect x="${gridX - 1}" y="${gridY - 1}" width="${gridW + 2}" height="${gridH + 2}" rx="${3 * scale}" ry="${3 * scale}" fill="none" stroke="${COLOR_BORDER}" stroke-width="${0.5 * scale}"/>`,
  );

  // Legend: level keys, wrapped to the figure width and centred under it.
  legendRows.forEach((row, rowIndex) => {
    const y = legendTop + rowIndex * LEGEND_ROW_H * scale;
    const blockX = PAD_S + (innerW - legendW) / 2;
    for (const [col, { label, score }] of row.entries()) {
      const lx = blockX + (colX[col] ?? 0);
      lines.push(
        `<rect x="${lx}" y="${y}" width="${SWATCH_S}" height="${SWATCH_S}" rx="${2 * scale}" ry="${2 * scale}" fill="${heatCellColor(monoColor, score)}"/>`,
      );
      lines.push(
        `<text x="${lx + SWATCH_S + 4 * scale}" y="${y + SWATCH_S - 3 * scale}" font-family="${FONT}" font-size="${FONT_LEGEND * scale}" fill="${COLOR_TEXT_DIM}">${escapeXml(label)}</text>`,
      );
    }
  });

  lines.push("</svg>");
  return lines.join("\n");
}
