import { describe, expect, it } from "vitest";
import type { Author } from "../author";
import { rolesWithContributions } from "../author";
import { makeUiTranslator } from "../credit-i18n/ui-strings";
import { CREDIT_ROLES } from "../credit-roles";
import { buildHeatmapSvg } from "../export/heatmap-svg";
import { createAuthor, parseAuthorText } from "../parse-authors";

function setScore(author: Author, role: string, score: number): void {
  const c = author.contributions.find((x) => x.role === role);
  if (!c) throw new Error(`missing role ${role}`);
  c.score = score;
}

function authorsWithScores(): Author[] {
  const authors = parseAuthorText("Jane Smith\nBob White");
  const [jane, bob] = authors;
  if (!(jane && bob)) throw new Error("expected 2 authors");
  setScore(jane, "Conceptualization", 100); // lead
  setScore(jane, "Writing – review & editing", 100); // exercises XML escaping
  setScore(bob, "Software", 100);
  return authors;
}

/** Cells = authors × roles that actually have a contributor. */
function expectedCellCount(authors: Author[]): number {
  return authors.length * rolesWithContributions(authors).length;
}

describe("buildHeatmapSvg", () => {
  it("produces a self-contained SVG with role labels, initials, and legend (no title)", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    // No baked-in image title: captions belong to the embedding document.
    expect(svg).not.toContain("CRediT Contribution Heatmap");
    expect(svg).toContain("Conceptualization");
    expect(svg).toContain(">JS<"); // author initials
    expect(svg).toContain(">Lead<"); // legend label, no score range
  });

  it("legend drops the meaningless 0–100 score ranges", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    expect(svg).not.toContain("67–100");
    expect(svg).not.toContain("(1–33)");
  });

  it("renders one cell per author × contributed role (default 22px cells)", () => {
    const authors = authorsWithScores();
    const svg = buildHeatmapSvg(authors);
    const cells = svg.match(/width="22"/g) ?? [];
    expect(cells).toHaveLength(expectedCellCount(authors));
  });

  it("omits roles no one contributed to", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    // Nobody has Methodology → its label must not appear.
    expect(svg).not.toContain("Methodology");
    // A contributed role does appear.
    expect(svg).toContain("Software");
  });

  it("renders a placeholder when there are no contributions", () => {
    const authors = parseAuthorText("Alice Brown");
    const svg = buildHeatmapSvg(authors);
    expect(svg).toContain("No contributions assigned yet.");
    expect(svg.match(/width="22"/g) ?? []).toHaveLength(0);
  });

  it("flat mode (showLevels=false) uses a two-key Contributed/None legend", () => {
    const svg = buildHeatmapSvg(authorsWithScores(), { showLevels: false });
    expect(svg).toContain(">Contributed<");
    expect(svg).not.toContain(">Equal<");
  });

  it("labels the axis with full names when acronyms is false", () => {
    const initialsSvg = buildHeatmapSvg(authorsWithScores());
    const namesSvg = buildHeatmapSvg(authorsWithScores(), { acronyms: false });
    // Default uses initials, not the full name, on the axis.
    expect(initialsSvg).toContain(">JS<");
    // Acronyms off renders the full author name on the axis.
    expect(namesSvg).toContain(">Jane Smith<");
  });

  it("escapes XML special characters in labels", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    expect(svg).toContain("Writing – review &amp; editing");
    expect(svg).not.toMatch(/review & editing/);
  });

  it("ramps a single accent in monochrome mode (the default)", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    expect(svg).toContain('fill="#1f4e79"'); // accent lead
    expect(svg).not.toContain('fill="#0072b2"'); // no per-author hue
  });

  it("localizes the level legend via translateUi", () => {
    const translateUi = makeUiTranslator({ lead: "Principal" });
    const svg = buildHeatmapSvg(authorsWithScores(), { translateUi });
    expect(svg).toContain(">Principal<"); // localized legend label
    expect(svg).not.toContain(">Lead<");
  });

  it("ramps the chosen base color to full strength for a lead cell", () => {
    const svg = buildHeatmapSvg(authorsWithScores(), { monoColor: "#404040" });
    expect(svg).toContain('fill="#404040"'); // base color at lead (fraction 1)
  });

  it("scales layout dimensions", () => {
    const svg = buildHeatmapSvg(authorsWithScores(), { scale: 2 });
    expect(svg).toContain('width="44"'); // 22 * 2
  });

  it("transposes axes while preserving the cell count", () => {
    const authors = authorsWithScores();
    const normal = buildHeatmapSvg(authors);
    const transposed = buildHeatmapSvg(authors, { transpose: true });
    expect(transposed).not.toBe(normal);
    const cells = transposed.match(/width="22"/g) ?? [];
    expect(cells).toHaveLength(expectedCellCount(authors));
  });

  it("renders the same cells regardless of contribution array order", () => {
    const canonical = CREDIT_ROLES.map((r) => ({
      role: r.name,
      score: r.name === "Software" ? 100 : 0,
    }));
    const shuffled = [...canonical].reverse();

    const a = buildHeatmapSvg([createAuthor("Jane Smith", { contributions: canonical })]);
    const b = buildHeatmapSvg([createAuthor("Jane Smith", { contributions: shuffled })]);

    expect(b).toBe(a);
  });

  it("names the graphic for assistive technology without drawing a title", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>Contribution heatmap</title>");
    // A <title> is an accessible name, not a caption: nothing draws it.
    expect(svg).not.toMatch(/<text[^>]*>Contribution heatmap</);
  });

  it("wraps the legend under a narrow figure instead of widening the canvas", () => {
    const everyRole = [
      createAuthor("Jane Smith", { contributions: CREDIT_ROLES.map((r) => ({ role: r.name, score: 100 })) }),
    ];
    const narrow = buildHeatmapSvg(authorsWithScores()); // 2 initials wide
    const wide = buildHeatmapSvg(everyRole, { transpose: true }); // all 14 roles wide

    // Two keys per row under the narrow figure, all four in one row under the wide one.
    expect(legendRowCount(narrow)).toBe(2);
    expect(legendRowCount(wide)).toBe(1);
    // The wrap is what keeps the narrow canvas narrow: it must not inherit the
    // width of an unwrapped four-key legend.
    expect(svgWidth(narrow)).toBeLessThan(svgWidth(wide));
  });

  it("sizes the label bands from the labels they carry", () => {
    // Initials on the left band vs. full names: the wider labels move the grid
    // right by their own extra width, and nothing else changes.
    const initials = buildHeatmapSvg(authorsWithScores(), { transpose: true });
    const names = buildHeatmapSvg(authorsWithScores(), { transpose: true, acronyms: false });
    expect(svgWidth(names)).toBeGreaterThan(svgWidth(initials));
    expect(firstCellX(names)).toBeGreaterThan(firstCellX(initials));
  });
});

/** Distinct y positions among the legend swatches (14×14 rects). */
function legendRowCount(svg: string): number {
  const ys = [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="14" height="14"/g)].map((m) => m[1]);
  return new Set(ys).size;
}

function svgWidth(svg: string): number {
  return Number(svg.match(/<svg[^>]*width="([\d.]+)"/)?.[1]);
}

/** x of the first grid cell — i.e. where the left label band ends. */
function firstCellX(svg: string): number {
  return Number(svg.match(/<rect x="([\d.]+)"[^>]*width="22" height="22"/)?.[1]);
}
