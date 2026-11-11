import { describe, expect, it } from "vitest";
import { heatmapPrintSize, heatmapPrintWarning, svgDimensions } from "../export/heatmap-print";
import { buildHeatmapSvg } from "../export/heatmap-svg";
import { createAuthor } from "../parse-authors";

const figure = '<svg width="96" height="192"><text font-size="12">Axis</text><text font-size="8">Key</text></svg>';

describe("final-size heatmap measurements", () => {
  it("measures the smallest text in points and height at the chosen physical width", () => {
    expect(heatmapPrintSize(figure, 25.4)).toMatchObject({ widthMm: 25.4, heightMm: 50.8 });
    expect(heatmapPrintSize(figure, 25.4).minFontPt).toBeCloseTo(6);
    expect(heatmapPrintSize(figure, 50.8)).toMatchObject({ widthMm: 50.8, heightMm: 101.6 });
    expect(heatmapPrintSize(figure, 50.8).minFontPt).toBeCloseTo(12);
  });

  it("uses the generated legend, omits a hidden legend and handles empty figures", () => {
    const authors = [createAuthor("Grace Hopper", { contributions: [{ role: "Software", score: 100 }] })];
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

  it.each([false, true])("warns when a team prints under 6 pt on a full page (horizontal: %s)", (horizontal) => {
    const team = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        createAuthor(`Rosalind Franklin ${i + 1}`, { contributions: [{ role: "Software", score: 100 }] }),
      );
    expect(heatmapPrintWarning(buildHeatmapSvg(team(10), { horizontal }))).toBeNull();
    expect(heatmapPrintWarning(buildHeatmapSvg(team(40), { horizontal }))).toMatch(/about 4\.\d pt .*183 × 170 mm/);
  });

  it("fits a tall figure to the page height before measuring", () => {
    // 96 × 960 px fitted to 170 mm tall is 17 mm wide, which prints its 12 px label at 6 pt.
    const tall = '<svg width="96" height="960"><text font-size="12">Axis</text></svg>';
    expect(heatmapPrintSize(tall, 17).minFontPt).toBeCloseTo(6.0, 1);
    expect(heatmapPrintWarning(tall)).toBeNull();
    expect(heatmapPrintWarning('<svg width="96" height="1000"><text font-size="12">Axis</text></svg>')).toMatch(
      /about 5\.8 pt/,
    );
  });
});
