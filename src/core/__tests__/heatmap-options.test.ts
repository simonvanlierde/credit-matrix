import { describe, expect, it } from "vitest";
import { contrastRatio, heatCellColor } from "../contributor-color";
import { buildHeatmapSvg } from "../export/heatmap-svg";
import { createAuthor } from "../parse-authors";

it("keeps shorthand colors accepted by the public monoColor option", () => {
  expect(
    buildHeatmapSvg([createAuthor("Tu Youyou", { contributions: [{ role: "Software", score: 100 }] })], {
      monoColor: "#abc",
    }),
  ).toContain('fill="#aabbcc"');
});

const authors = [createAuthor("Tu Youyou", { contributions: [{ role: "Software", score: 33 }] })];

describe("heatmap figure options", () => {
  it("draws square cells with a thin neutral rule by default", () => {
    expect(buildHeatmapSvg(authors)).toMatch(/width="22" height="22" rx="0" ry="0"[^>]*stroke="#c9c9c5"/);
  });
  it("uses the same shape, size and palette for the cells and legend", () => {
    const svg = buildHeatmapSvg(authors, { shape: "circle", size: 30, palette: "green" });
    expect(svg).toMatch(/width="30" height="30" rx="15" ry="15"/);
    expect(svg).toContain('fill="#99c7b7"');
  });
  it("can hide the legend and show all roles with abbreviated labels", () => {
    const svg = buildHeatmapSvg(authors, { legend: false, skipempty: false, labels: "short" });
    expect(svg).not.toContain(">Supporting<");
    expect(svg).toContain(">1 Conceptualiz…<");
    expect(svg.match(/width="22" height="22"/g)).toHaveLength(14);
  });
  it("rejects invalid options before drawing invalid SVG", () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildHeatmapSvg(authors, { size })).toThrow("size");
    }
    expect(() => buildHeatmapSvg(authors, { color: 'red" onload="alert(1)' })).toThrow("color");
  });
});

it("keeps each palette sequential in grayscale", () => {
  for (const hue of ["#1f4e79", "#00724c", "#404040"]) {
    const contrast = [0, 33, 66, 100].map((score) => contrastRatio(heatCellColor(hue, score), "#ffffff"));
    for (let i = 1; i < contrast.length; i++) expect(contrast[i]).toBeGreaterThan(contrast[i - 1] ?? 0);
  }
});
