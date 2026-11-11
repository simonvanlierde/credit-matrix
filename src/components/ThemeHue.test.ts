import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/core/contributor-color";
import { accentFor } from "./ThemeHue";

describe("accentFor", () => {
  it("keeps a hue that already carries text", () => {
    expect(accentFor("#1f4e79", false)).toBe("#1f4e79");
  });

  it("deepens a mid-tone hue just until it reaches 4.5:1 on bright paper", () => {
    const accent = accentFor("#009e73", false);
    expect(accent).not.toBe("#009e73");
    expect(contrastRatio(accent ?? "", "#fffdf8")).toBeGreaterThanOrEqual(4.5);
  });

  it("lightens toward white on the dark theme", () => {
    expect(contrastRatio(accentFor("#404040", true) ?? "", "#24221f")).toBeGreaterThanOrEqual(4.5);
  });

  it("refuses a value that is not a hex colour", () => {
    expect(accentFor("red", false)).toBeNull();
  });
});
