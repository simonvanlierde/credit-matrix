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
