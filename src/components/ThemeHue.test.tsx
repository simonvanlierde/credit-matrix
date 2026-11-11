import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthor } from "@/core";
import { CONTRIBUTOR_HUES, contrastRatio, DEFAULT_MONO_COLOR, mixHex } from "@/core/contributor-color";
import { useContributionStore } from "@/store/contribution-store";
import { accentFor, ThemeHue } from "./ThemeHue";

describe("accentFor", () => {
  it("keeps a hue that already reaches text contrast", () => {
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

  it.each([false, true])("reaches text contrast on the tinted page and the chip wash (dark: %s)", (dark) => {
    const paper = dark ? "#161513" : "#fbf8f1";
    const tint = dark ? 0.04 : 0.03;
    for (const hue of [...CONTRIBUTOR_HUES, "#009e73", "#0072b2", "#e69f00", "#56b4e9", "#cc79a7"]) {
      const accent = accentFor(hue, dark) ?? "";
      const page = mixHex(paper, hue, tint);
      expect(contrastRatio(accent, page), hue).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accent, mixHex(page, accent, 0.1)), hue).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("refuses a value that is not a hex colour", () => {
    expect(accentFor("red", false)).toBeNull();
  });
});

describe("ThemeHue", () => {
  const root = document.documentElement.style;
  const reset = () => {
    useContributionStore.getState().reset();
    root.removeProperty("--color-theme");
    root.removeProperty("--color-accent");
  };
  beforeEach(reset);
  afterEach(reset);

  const authors = (n: number) => Array.from({ length: n }, (_, i) => createAuthor(`Person ${i}`));
  const mount = () => render(<ThemeHue />);

  it("sets the page tint and accent from the mono colour", () => {
    act(() => useContributionStore.getState().setColorByContributor(false));
    mount();
    expect(root.getPropertyValue("--color-theme")).toBe(DEFAULT_MONO_COLOR);
    expect(root.getPropertyValue("--color-accent")).toBe(accentFor(DEFAULT_MONO_COLOR, false));
  });

  it("goes back to plain paper and drops the accent when colouring per contributor", () => {
    act(() => {
      useContributionStore.getState().loadAuthors(authors(2));
      useContributionStore.getState().setColorByContributor(false);
    });
    mount();
    expect(root.getPropertyValue("--color-accent")).not.toBe("");
    act(() => useContributionStore.getState().setColorByContributor(true));
    expect(root.getPropertyValue("--color-theme")).toBe("var(--color-paper)");
    expect(root.getPropertyValue("--color-accent")).toBe("");
  });

  it("follows the mono colour when there are more contributors than hues", () => {
    act(() => {
      useContributionStore.getState().loadAuthors(authors(CONTRIBUTOR_HUES.length + 1));
      useContributionStore.getState().setColorByContributor(true);
    });
    mount();
    expect(root.getPropertyValue("--color-theme")).toBe(DEFAULT_MONO_COLOR);
    expect(root.getPropertyValue("--color-accent")).not.toBe("");
  });
});
