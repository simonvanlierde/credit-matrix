import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DEFAULT_MONO_COLOR,
  heatCellColor,
  OKABE_ITO,
  ON_COLOR_DARK,
  ON_COLOR_LIGHT,
  onColor,
} from "../contributor-color";

/** The empty-cell fill, mirrored from contributor-color.ts. */
const NONE_FILL = "#ececea";

/** WCAG 1.4.11 floor for a graphical object that conveys state. */
const NON_TEXT_MIN = 3;

const ALL_HUES = [DEFAULT_MONO_COLOR, ...OKABE_ITO];
const SCORES = [33, 66, 100];

describe("contrastRatio", () => {
  it("matches known WCAG reference pairs", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Order must not matter.
    expect(contrastRatio("#1f4e79", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#1f4e79"), 10);
  });
});

describe("onColor", () => {
  it("picks the higher-contrast foreground for every offered hue at every level", () => {
    for (const hue of ALL_HUES) {
      for (const score of SCORES) {
        const fill = heatCellColor(hue, score);
        const fg = onColor(fill);
        expect(contrastRatio(fill, fg), `${hue} @ ${score} → fill ${fill}, chose ${fg}`).toBeGreaterThanOrEqual(
          NON_TEXT_MIN,
        );
      }
    }
  });

  it("chooses dark ink on a light fill and white on a dark fill", () => {
    // Okabe-Ito yellow is light enough that a white glyph disappears on it.
    expect(onColor("#f0e442")).toBe(ON_COLOR_DARK);
    expect(onColor("#1f4e79")).toBe(ON_COLOR_LIGHT);
  });

  it("falls back safely on a malformed color rather than throwing", () => {
    // rgb() clamps unparseable input to black, so the glyph must go light.
    expect(onColor("not-a-color")).toBe(ON_COLOR_LIGHT);
  });
});

describe("heatCellColor tiers", () => {
  it("keeps the lowest assigned tier distinguishable from an empty cell", () => {
    // Regression: at the old 0.25 mix the default hue's "supporting" cell sat
    // ~1.29:1 against the empty fill, so an assigned cell read as unassigned.
    const supporting = heatCellColor(DEFAULT_MONO_COLOR, 33);
    expect(contrastRatio(supporting, NONE_FILL)).toBeGreaterThan(1.5);
  });

  it("keeps the three assigned tiers ordered and distinct", () => {
    for (const hue of ALL_HUES) {
      const [supporting, equal, lead] = SCORES.map((s) => heatCellColor(hue, s));
      expect(new Set([supporting, equal, lead]).size, `${hue} tiers collapsed`).toBe(3);
    }
  });

  it("returns a well-formed hex for hostile input, so SVG fill needs no escaping", () => {
    // heatCellColor is the only path monoColor takes into an SVG fill attribute.
    for (const attack of ['"/><script>alert(1)</script>', 'red" onload="alert(1)', "javascript:x"]) {
      expect(heatCellColor(attack, 100)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
