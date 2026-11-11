import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { CONTRIBUTOR_HUES, contrastRatio, DEFAULT_MONO_COLOR, mixHex } from "@/core/contributor-color";
import { accentFor } from "@/lib/theme-color";
import { useDark } from "@/lib/use-dark";
import { useHydrated } from "@/lib/use-hydrated";
import { useContributionStore } from "@/store/contribution-store";
import { ThemeHue } from "./ThemeHue";

vi.mock("@/lib/use-dark", () => ({ useDark: vi.fn(() => false) }));

vi.mock("@/lib/use-hydrated", () => ({ useHydrated: vi.fn(() => true) }));

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
    act(() => useContributionStore.getState().reset());
    root.removeProperty("--color-theme");
    root.removeProperty("--color-accent");
    root.removeProperty("--color-primary");
    root.removeProperty("--color-primary-hover");
    vi.mocked(useDark).mockReturnValue(false);
    vi.mocked(useHydrated).mockReturnValue(true);
  };
  beforeEach(reset);
  afterEach(reset);

  const authors = (n: number) => Array.from({ length: n }, (_, i) => createAuthor(`Person ${i}`));
  const mount = () => render(<ThemeHue />);

  it("preserves prepaint colours until the draft is hydrated", () => {
    root.setProperty("--color-primary", "#21763c");
    vi.mocked(useHydrated).mockReturnValue(false);
    const view = mount();
    expect(root.getPropertyValue("--color-primary")).toBe("#21763c");
    vi.mocked(useHydrated).mockReturnValue(true);
    act(() => useContributionStore.getState().setHeatmapMonoColor("#9c433f"));
    view.rerender(<ThemeHue />);
    expect(root.getPropertyValue("--color-primary")).toBe(accentFor("#9c433f", false));
  });

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
    expect(root.getPropertyValue("--color-primary")).toBe("");
    expect(root.getPropertyValue("--color-primary-hover")).toBe("");
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
  it.each([false, true])(
    "uses the selected hue for links and buttons, with readable hover fills (dark: %s)",
    (dark) => {
      vi.mocked(useDark).mockReturnValue(dark);
      mount();
      for (const hue of ["#21763c", "#9c433f", "#ffffff", "#ffff00", "#000000"]) {
        act(() => useContributionStore.getState().setHeatmapMonoColor(hue));
        const primary = root.getPropertyValue("--color-primary");
        const hover = root.getPropertyValue("--color-primary-hover");
        expect(primary).toBe(accentFor(hue, dark));
        expect(contrastRatio(primary, dark ? "#24221f" : "#fffdf8")).toBeGreaterThanOrEqual(4.5);
        for (const fill of [primary, hover]) {
          expect(contrastRatio(fill, dark ? "#16181c" : "#ffffff")).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );
});
