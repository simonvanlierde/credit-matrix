/**
 * Canonical heatmap-color logic, shared by the live UI and the SVG/PNG export so
 * on-screen and exported heatmaps never drift. Heatmap intensity encodes the
 * contribution *level*; the single base hue (the chosen mono color) carries no
 * meaning beyond legibility: contributors are identified by the row/column labels.
 */

/** Default hue for the heatmap (the app's ink-blue accent). */
export const DEFAULT_MONO_COLOR = "#1f4e79";

/**
 * Okabe–Ito categorical palette, offered as preset hues in the color picker.
 * The palette's black is softened to a dark gray for on-screen legibility.
 */
export const OKABE_ITO = [
  "#0072b2",
  "#e69f00",
  "#009e73",
  "#cc79a7",
  "#d55e00",
  "#56b4e9",
  "#f0e442",
  "#404040",
] as const;

const NONE_FILL = "#ececea";
const MIX_TOWARD = "#ffffff";

/**
 * CRediT score (0–100) → fraction of the base hue to show (0 = empty).
 *
 * The lowest tier is 0.4 rather than 0.25: at 0.25 a "supporting" cell mixed
 * with white sits ~1.3:1 against the empty-cell fill, which reads as empty.
 * The tiers stay far enough apart (0.4 / 0.7 / 1) to remain distinguishable.
 */
function scoreFraction(score: number): number {
  if (score <= 0) return 0;
  if (score <= 33) return 0.4;
  if (score <= 66) return 0.7;
  return 1;
}

/** Heatmap cell fill. `hue` is the chosen base color; intensity scales by score. */
export function heatCellColor(hue: string, score: number): string {
  const fraction = scoreFraction(score);
  if (fraction === 0) return NONE_FILL;
  return mixHex(MIX_TOWARD, hue, fraction);
}

/** Linear mix of two hex colors; t=0 → a, t=1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const round = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[round(ar, br), round(ag, bg), round(ab, bb)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.x relative luminance: gamma-linearised. */
function wcagLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [wcagLuminance(a), wcagLuminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink (near-black) or paper (white), whichever contrasts better against `background`. */
export const ON_COLOR_DARK = "#16181c";
export const ON_COLOR_LIGHT = "#ffffff";

/**
 * Foreground for a glyph drawn on `background`.
 *
 * Picks by measured contrast rather than a luminance threshold, so a light hue
 * (e.g. the Okabe–Ito yellow) gets dark ink instead of an invisible white mark.
 */
export function onColor(background: string): string {
  return contrastRatio(background, ON_COLOR_DARK) >= contrastRatio(background, ON_COLOR_LIGHT)
    ? ON_COLOR_DARK
    : ON_COLOR_LIGHT;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  // Expand shorthand (#abc → #aabbcc) and reject anything else so a malformed
  // color can't poison mixHex/contrastRatio with NaN channels.
  const full = h.length === 3 ? h.replace(/./g, "$&$&") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
