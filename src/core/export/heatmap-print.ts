/** Intrinsic dimensions of a figure produced by buildHeatmapSvg. */
export function svgDimensions(svg: string) {
  const dimensions = svg.match(/<svg\b[^>]*\bwidth="([\d.]+)" height="([\d.]+)"/);
  if (!dimensions) throw new Error("SVG dimensions missing");
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)))
    throw new RangeError("SVG dimensions must be finite and positive");
  return { width, height };
}

/** Physical layout of our generated SVG, including the smallest axis or legend text. */
export function heatmapPrintSize(svg: string, widthMm: number) {
  if (!(widthMm > 0 && Number.isFinite(widthMm))) throw new RangeError("Print width must be finite and positive");
  const dimensions = svgDimensions(svg);
  const sizes = [...svg.matchAll(/<text\b[^>]*\bfont-size="([\d.]+)"/g)].map((match) => Number(match[1]));
  if (!sizes.length || sizes.some((size) => !(size > 0 && Number.isFinite(size))))
    throw new Error("SVG text sizes missing or invalid");
  return {
    widthMm,
    heightMm: (dimensions.height / dimensions.width) * widthMm,
    minFontPt: (Math.min(...sizes) * widthMm * 72) / (dimensions.width * 25.4),
  };
}

/**
 * Below this size a heatmap's labels print too small to read. The app measures at the width the user
 * picked; `heatmapPrintWarning` at a full page.
 */
export const SMALL_PRINT_PT = 6;

/**
 * The largest figure a journal page takes: a double column, 183 mm, by 170 mm (the Nature figure
 * guide's reference bounds; e2e/heatmap-print.spec.ts checks the same box).
 */
const PAGE_FIGURE_MM = { width: 183, height: 170 } as const;

/**
 * A warning when a heatmap scaled to fit a full journal page prints its smallest label under 6 pt,
 * or null. The CLI writes it to stderr and the document plugins show it as a
 * build warning; the app shows its own, translated, at the width the user chose.
 * @throws {Error} or {RangeError} for an SVG without positive dimensions or text sizes; a
 * {@link buildHeatmapSvg} figure always has them.
 */
export function heatmapPrintWarning(svg: string): string | null {
  const { width, height } = svgDimensions(svg);
  const widthMm = Math.min(PAGE_FIGURE_MM.width, (PAGE_FIGURE_MM.height * width) / height);
  const { minFontPt } = heatmapPrintSize(svg, widthMm);
  if (minFontPt >= SMALL_PRINT_PT) return null;
  // Rounded down, so 5.97 pt never reads "about 6.0 pt" under a 6 pt threshold.
  const size = (Math.floor(minFontPt * 10) / 10).toFixed(1);
  return `the heatmap's smallest labels print at about ${size} pt when it fits a full page (183 × 170 mm). Under ${SMALL_PRINT_PT} pt they are hard to read: use initials or transpose it for a small team, or give a large team's figure a page of its own, such as a supplementary figure.`;
}
