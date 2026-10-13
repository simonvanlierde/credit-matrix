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

/**
 * Dark-theme lightness per tier, Supporting → Lead. Mixing toward white (the
 * light ramp) would make Supporting the brightest cell on a dark page, so the
 * dark ramp keeps the hue and climbs in lightness instead: the strongest claim
 * stays the most prominent cell in both themes.
 */
const DARK_TIER_LIGHTNESS = [0.3, 0.48, 0.77];

/**
 * Heatmap cell fill. `hue` is the chosen base color; intensity scales by score.
 * `dark` switches to the dark-theme ramp. Exports always use the light one,
 * since a figure goes onto a white page.
 */
export function heatCellColor(hue: string, score: number, dark = false): string {
  const fraction = scoreFraction(score);
  if (fraction === 0) return NONE_FILL;
  if (!dark) return mixHex(MIX_TOWARD, hue, fraction);
  const [h, s] = hsl(hue);
  const tier = fraction < 0.5 ? 0 : fraction < 1 ? 1 : 2;
  return hslHex(h, Math.min(s, 0.65), DARK_TIER_LIGHTNESS[tier] ?? 0.5);
}

/** Hue (0–1), saturation and lightness of a hex color. */
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[channel(0), channel(8), channel(4)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Linear mix of two hex colors; t=0 → a, t=1 → b. */
function mixHex(a: string, b: string, t: number): string {
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
