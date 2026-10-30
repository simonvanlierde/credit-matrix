import { describe, expect, it } from "vitest";
import type { Author } from "../author";
import { rolesWithContributions } from "../author";
import { DEFAULT_MONO_COLOR, heatCellColor } from "../contributor-color";
import { makeUiTranslator } from "../credit-i18n/ui-strings";
import { CREDIT_ROLES } from "../credit-roles";
import { GENERATOR_NOTE } from "../export/generator-note";
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

  it("carries who did what as its text alternative, in <desc>", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    const desc = svg.match(/<desc>(.*)<\/desc>/s)?.[1] ?? "";
    expect(desc).toContain("Jane Smith: Conceptualization");
    expect(desc).toContain("Writing – review &amp; editing"); // escaped once
    expect(desc).toContain("Bob White: Software");
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

  it("colors each cell by its own author's score, in both orientations and in flat mode", () => {
    const [jane, bob] = parseAuthorText("Jane Smith\nBob White");
    if (!(jane && bob)) throw new Error("expected 2 authors");
    setScore(jane, "Conceptualization", 33);
    setScore(bob, "Software", 66);
    const fills = (svg: string) => [...svg.matchAll(/width="22" height="22"[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    const color = (score: number) => heatCellColor(DEFAULT_MONO_COLOR, score);

    // Rows are roles, columns authors: Jane then Bob, for Conceptualization then Software.
    expect(fills(buildHeatmapSvg([jane, bob]))).toEqual([color(33), color(0), color(0), color(66)]);
    expect(fills(buildHeatmapSvg([jane, bob], { transpose: true }))).toEqual([
      color(33),
      color(0),
      color(0),
      color(66),
    ]);
    expect(fills(buildHeatmapSvg([jane, bob], { showLevels: false }))).toEqual([
      color(100),
      color(0),
      color(0),
      color(100),
    ]);
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

  it("tags its text alternative with the output language", () => {
    const authors = authorsWithScores();
    for (const svg of [buildHeatmapSvg(authors, { locale: "ja" }), buildHeatmapSvg([], { locale: "ja" })]) {
      expect(svg).toMatch(/^<svg [^>]* xml:lang="ja" lang="ja"/);
    }
    expect(buildHeatmapSvg(authors)).not.toContain("lang=");
    expect(buildHeatmapSvg(authors)).toMatch(/^<svg [^>]*role="img">/);
  });

  it("states each contribution level in <desc> unless levels are off, as the figure does", () => {
    const desc = (svg: string) => svg.match(/<desc>(.*)<\/desc>/s)?.[1] ?? "";
    const authors = authorsWithScores();
    if (authors[1]) setScore(authors[1], "Software", 33);
    const levels = desc(buildHeatmapSvg(authors));
    const flat = desc(buildHeatmapSvg(authors, { showLevels: false }));
    expect(levels).toContain("Bob White: Software (Supporting)");
    expect(flat).toContain("Bob White: Software");
    expect(flat).not.toContain("(Supporting)");
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

  describe("canvas geometry", () => {
    // Two authors, three contributed roles. The widest label is "Writing – review & editing"
    // (26 characters), which also happens to be the last role and so the last top label when transposed.
    const DIAG = Math.SQRT1_2;
    const WIDE_ROLE = 26 * 0.62; // em units; times the font size gives the label width

    function geometry(svg: string) {
      const head = svg.match(/<svg [^>]*width="([\d.]+)" height="([\d.]+)" viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const border = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="none"/);
      if (!(head && border)) throw new Error("no svg header or grid border");
      const [w, h, vw, vh, bx, by, bw, bh] = [...head.slice(1), ...border.slice(1)].map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      return { w, h, vw, vh, bx, by, bw, bh };
    }

    it("sizes the canvas to its labels, grid and wrapped legend", () => {
      const g = geometry(buildHeatmapSvg(authorsWithScores()));
      // left band = widest role label at 10.5px + 6 gap; 24 padding each side.
      const leftBand = WIDE_ROLE * 10.5 + 6;
      expect(g.w).toBeCloseTo(24 * 2 + leftBand + (2 * 24 - 2), 6);
      // top band = "JS" at 11px, rotated 45 degrees, + 6 gap. Grid is 3 rows tall, then an
      // 18px gap, a legend wrapped to two rows (14px swatch + 20px pitch) and the bottom padding.
      const topBand = 2 * 11 * 0.62 * DIAG + 6;
      expect(g.h).toBeCloseTo(24 + topBand + (3 * 24 - 2) + 18 + (14 + 20) + 24, 6);
      expect([g.vw, g.vh]).toEqual([g.w, g.h]);
      // The border sits one pixel outside the grid, which starts after the padding and labels.
      expect(g.bx).toBeCloseTo(24 + leftBand - 1, 6);
      expect(g.by).toBeCloseTo(24 + topBand - 1, 6);
      expect([g.bw, g.bh]).toEqual([2 * 24 - 2 + 2, 3 * 24 - 2 + 2]);
    });

    it("swaps the grid axes when transposed, and lets the last top label overhang the right edge", () => {
      const g = geometry(buildHeatmapSvg(authorsWithScores(), { transpose: true }));
      const leftBand = 2 * 10.5 * 0.62 + 6; // "JS" now runs down the left
      const topBand = WIDE_ROLE * 11 * DIAG + 6; // roles are rotated across the top
      const overhang = WIDE_ROLE * 11 * DIAG - 22 / 2; // last label climbs past the half-cell it starts from
      expect(g.w).toBeCloseTo(24 * 2 + leftBand + (3 * 24 - 2) + overhang, 6);
      expect(g.h).toBeCloseTo(24 + topBand + (2 * 24 - 2) + 18 + (14 + 20) + 24, 6);
      expect([g.vw, g.vh]).toEqual([g.w, g.h]);
      expect([g.bw, g.bh]).toEqual([3 * 24, 2 * 24]);
      expect(g.bx).toBeCloseTo(24 + leftBand - 1, 6);
      expect(g.by).toBeCloseTo(24 + topBand - 1, 6);
    });

    it("keeps the legend on one row when its keys fit, and on two when they do not", () => {
      const levels = geometry(buildHeatmapSvg(authorsWithScores()));
      const flat = geometry(buildHeatmapSvg(authorsWithScores(), { showLevels: false }));
      // Same grid, so the height differs by one legend row (20px pitch).
      expect(levels.h - flat.h).toBeCloseTo(20, 6);
      expect(flat.w).toBeCloseTo(levels.w, 6);
    });

    it("scales every dimension linearly", () => {
      const one = geometry(buildHeatmapSvg(authorsWithScores()));
      const two = geometry(buildHeatmapSvg(authorsWithScores(), { scale: 2 }));
      for (const key of ["w", "h", "vw", "vh"] as const) {
        expect(two[key]).toBeCloseTo(one[key] * 2, 6);
      }
      // The border sits a fixed 1px outside the grid, which does not scale.
      expect(two.bx + 1).toBeCloseTo((one.bx + 1) * 2, 6);
      expect(two.by + 1).toBeCloseTo((one.by + 1) * 2, 6);
      expect([two.bw, two.bh]).toEqual([94, 142]);
    });

    it("renders a fixed-size placeholder, scaled, when nothing is contributed", () => {
      const svg = buildHeatmapSvg(parseAuthorText("Alice Brown"), { scale: 2 });
      expect(svg).toContain('width="640" height="112" viewBox="0 0 640 112"');
      expect(svg).toContain(`<!-- ${GENERATOR_NOTE} -->`);
      expect(svg).toContain("<title>Contribution heatmap</title>");
      expect(svg).toMatch(/<rect width="640" height="112" fill="#[0-9a-f]{6}"\/>/);
      // The message keeps its place on the padded canvas at any scale.
      expect(svg).toMatch(
        /<text x="48" y="64" [^>]*font-size="22"[^>]*>No contributions assigned yet\.<\/text>\n<\/svg>$/,
      );
    });

    it("notes its generator and fills the whole canvas behind the figure", () => {
      const svg = buildHeatmapSvg(authorsWithScores());
      const g = geometry(svg);
      expect(svg).toContain(`<!-- ${GENERATOR_NOTE} -->`);
      expect(svg).toContain(`<rect width="${g.w}" height="${g.h}" fill="#`);
    });
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

describe("buildHeatmapSvg placement", () => {
  /** Every numeric attribute and translate() argument of each drawn element, in document order. */
  function numbers(svg: string): number[] {
    return [...svg.matchAll(/<(?:rect|text)\b[^>]*>/g)]
      .filter(([tag]) => !tag.includes('fill="none"'))
      .flatMap(([tag]) => [
        ...[...tag.matchAll(/ (?!font-weight)[\w-]+="(-?[\d.]+)"/g)].map((m) => Number(m[1])),
        ...[...tag.matchAll(/translate\((-?[\d.]+),(-?[\d.]+)\)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]),
      ]);
  }

  const cells = (svg: string) =>
    [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="22" height="22"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
  const swatches = (svg: string) =>
    [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="14" height="14"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
  const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

  it("draws every element, labels and legend included, at the given scale", () => {
    for (const transpose of [false, true]) {
      const one = numbers(buildHeatmapSvg(authorsWithScores(), { transpose }));
      const two = numbers(buildHeatmapSvg(authorsWithScores(), { transpose, scale: 2 }));
      expect(two).toHaveLength(one.length);
      two.forEach((value, i) => {
        expect(value).toBeCloseTo((one[i] ?? Number.NaN) * 2, 6);
      });
    }
    // The grid border sits a fixed 1px outside the grid, but its corners and stroke scale.
    const border = (svg: string) =>
      svg.match(/rx="([\d.]+)" ry="([\d.]+)" fill="none"[^>]*stroke-width="([\d.]+)"/)?.slice(1);
    expect(border(buildHeatmapSvg(authorsWithScores(), { scale: 2 }))).toEqual(["6", "6", "1"]);
  });

  it("puts each axis label beside the column or row it names", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    const columnXs = unique(cells(svg).map((cell) => cell.x));
    const rowYs = unique(cells(svg).map((cell) => cell.y));
    // Cells sit on a 24px pitch: 22px cells and a 2px gap.
    expect((columnXs[1] ?? 0) - (columnXs[0] ?? 0)).toBeCloseTo(24, 6);
    expect(rowYs.slice(1).map((y, i) => y - (rowYs[i] ?? 0))).toEqual([24, 24]);

    // Top labels start at the middle of their column, one label gap above the grid.
    const top = [...svg.matchAll(/translate\(([\d.]+),([\d.]+)\) rotate\(-45\)[^>]*>([^<]*)</g)];
    expect(top.map((m) => m[3])).toEqual(["JS", "BW"]);
    expect(top.map((m) => Number(m[1]))).toEqual(columnXs.map((x) => x + 11));
    for (const m of top) expect(Number(m[2])).toBeCloseTo((rowYs[0] ?? 0) - 6, 6);

    // Left labels end one label gap before the grid, on their row's baseline.
    const left = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="end"[^>]*>([^<]*)</g)];
    expect(left.map((m) => m[3])).toEqual(["Conceptualization", "Software", "Writing – review &amp; editing"]);
    for (const m of left) expect(Number(m[1])).toBeCloseTo((columnXs[0] ?? 0) - 6, 6);
    expect(left.map((m) => Number(m[2]))).toEqual(rowYs.map((y) => y + 15));
  });

  it("lines a wrapped legend up in columns, centred under the figure, with each label beside its swatch", () => {
    const svg = buildHeatmapSvg(authorsWithScores());
    const keys = swatches(svg);
    // Lead, Equal / Supporting, None: two rows on a 20px pitch, in two shared columns.
    expect(unique(keys.map((key) => key.y))).toHaveLength(2);
    expect((keys[2]?.y ?? 0) - (keys[0]?.y ?? 0)).toBeCloseTo(20, 6);
    expect([keys[2]?.x, keys[3]?.x]).toEqual([keys[0]?.x, keys[1]?.x]);
    // The first column is as wide as its widest key: "Supporting" (10 characters at 10px), the
    // 14px swatch, the 6px gap before the label and the 20px gap after it.
    const firstColumn = 14 + 6 + 10 * 10 * 0.62 + 20;
    expect((keys[1]?.x ?? 0) - (keys[0]?.x ?? 0)).toBeCloseTo(firstColumn, 6);
    // Centred: the block is the two columns minus the trailing gap, with equal room either side.
    const secondColumn = 14 + 6 + 5 * 10 * 0.62 + 20; // "Equal" and "None" are no wider
    const legendW = firstColumn + secondColumn - 20;
    expect((keys[0]?.x ?? 0) - 24).toBeCloseTo((svgWidth(svg) - 48 - legendW) / 2, 6);

    const labels = [
      ...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-family="[^"]*" font-size="10"[^>]*>([^<]*)</g),
    ];
    expect(labels.map((m) => m[3])).toEqual(["Lead", "Equal", "Supporting", "None"]);
    labels.forEach((m, i) => {
      expect(Number(m[1])).toBeCloseTo((keys[i]?.x ?? 0) + 18, 6);
      expect(Number(m[2])).toBeCloseTo((keys[i]?.y ?? 0) + 11, 6);
    });
  });
});

describe("buildHeatmapSvg legend wrapping", () => {
  const legendRows = (role: string) =>
    legendRowCount(buildHeatmapSvg([createAuthor("Jane Smith", { contributions: [{ role, score: 100 }] })]));

  it("stacks one key per row when no two keys fit side by side", () => {
    // A Methodology-only figure (about 100px wide) is narrower than any pair of keys but wider than
    // the widest key, "Supporting" (82px).
    expect(legendRows("Methodology")).toBe(4);
    // Conceptualization (about 139px) fits "Lead, Equal" but not "Supporting, None": every row
    // must fit, so the keys still stack.
    expect(legendRows("Conceptualization")).toBe(4);
  });
});
