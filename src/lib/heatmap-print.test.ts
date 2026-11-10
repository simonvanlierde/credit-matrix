import { describe, expect, it } from "vitest";
import { buildHeatmapSvg } from "@/core/export/heatmap-svg";
import { createAuthor } from "@/core/parse-authors";
import { heatmapPrintSize, svgDimensions } from "./heatmap-print";

const figure = '<svg width="96" height="192"><text font-size="12">Axis</text><text font-size="8">Key</text></svg>';

describe("final-size heatmap measurements", () => {
  it("measures the smallest text in points and height at the chosen physical width", () => {
    expect(heatmapPrintSize(figure, 25.4)).toMatchObject({ widthMm: 25.4, heightMm: 50.8 });
    expect(heatmapPrintSize(figure, 25.4).minFontPt).toBeCloseTo(6);
    expect(heatmapPrintSize(figure, 50.8)).toMatchObject({ widthMm: 50.8, heightMm: 101.6 });
    expect(heatmapPrintSize(figure, 50.8).minFontPt).toBeCloseTo(12);
  });

  it("uses the generated legend, omits a hidden legend and handles empty figures", () => {
    const authors = [createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] })];
    for (const scale of [1, 2]) {
      for (const legend of [true, false]) {
        const svg = buildHeatmapSvg(authors, { legend, scale });
        const metrics = heatmapPrintSize(svg, 89);
        expect(metrics.minFontPt).toBeCloseTo(
          ((legend ? 10 : 10.5) * scale * 89 * 72) / (svgDimensions(svg).width * 25.4),
        );
      }
    }
    expect(heatmapPrintSize(buildHeatmapSvg([]), 89).minFontPt).toBeGreaterThan(5);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid physical widths (%s)", (width) => {
    expect(() => heatmapPrintSize(figure, width)).toThrow("Print width");
  });

  it.each(["<svg/>", '<svg width="0" height="10"/>', '<svg width="10" height="."/>'])(
    "rejects missing or invalid figure dimensions",
    (svg) => {
      expect(() => heatmapPrintSize(svg, 89)).toThrow(/dimensions/);
    },
  );

  it.each(['<svg width="10" height="10"/>', '<svg width="10" height="10"><text font-size="0"/></svg>'])(
    "rejects figures without measurable text",
    (svg) => {
      expect(() => heatmapPrintSize(svg, 89)).toThrow(/text sizes/);
    },
  );
});
