// biome-ignore lint/correctness/noNodejsModules: the Typst palette copy is a file in the repo
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRIBUTOR_HUES, contrastRatio, heatCellColor } from "../contributor-color";
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
  it("colours each author with their own hue only when asked, with a neutral key", () => {
    const pair = [
      createAuthor("Tu Youyou", { contributions: [{ role: "Software", score: 100 }] }),
      createAuthor("Ada Lovelace", { contributions: [{ role: "Software", score: 100 }] }),
    ];
    const [first, second] = CONTRIBUTOR_HUES;
    const byColor = buildHeatmapSvg(pair);
    expect(byColor).not.toContain(`fill="${first}"`);
    const byPerson = buildHeatmapSvg(pair, { colorBy: "contributor" });
    expect(byPerson).toContain(`fill="${first}"`);
    expect(byPerson).toContain(`fill="${second}"`);
    // The key is the neutral ramp, not either person's hue.
    expect(byPerson).toContain('fill="#404040"');
    expect(() => buildHeatmapSvg(pair, { colorBy: "rainbow" as "color" })).toThrow("colorBy");
  });
  it("draws everyone and the key in one hue past the palette's eight people", () => {
    const many = Array.from({ length: CONTRIBUTOR_HUES.length + 1 }, (_, i) =>
      createAuthor(`Person ${i + 1}`, { contributions: [{ role: "Software", score: 100 }] }),
    );
    const svg = buildHeatmapSvg(many, { colorBy: "contributor" });
    expect(svg).toBe(buildHeatmapSvg(many));
    expect(svg).not.toContain('fill="#404040"');
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

describe("shipped palettes", () => {
  const palettes = { blue: "#1f4e79", green: "#00724c", gray: "#404040" } as const;
  const typst = readFileSync(new URL("../../../integrations/typst/lib.typ", import.meta.url), "utf8");

  it.each(Object.entries(palettes))("%s: the lowest level stays visible against an empty cell", (palette, hue) => {
    const svg = buildHeatmapSvg(authors, { palette: palette as keyof typeof palettes });
    const lowest = heatCellColor(hue, 33);
    expect(svg).toContain(`fill="${lowest}"`);
    expect(contrastRatio(lowest, "#ececea")).toBeGreaterThan(1.5);
    expect(typst).toContain(`${palette}: rgb("${hue}")`);
  });
});
