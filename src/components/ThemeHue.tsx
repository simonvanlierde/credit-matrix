import { useEffect } from "react";
import { contrastRatio, contributorHues, mixHex, pageMarkColor } from "@/core/contributor-color";
import { useDark } from "@/lib/use-dark";
import { useContributionStore } from "@/store/contribution-store";

/** The bright paper behind cards and under accent text, per theme (globals.css). */
const SURFACE_BRIGHT = { light: "#fffdf8", dark: "#24221f" };

/**
 * The accent for a heatmap hue: the hue as the mark draws it, deepened toward the
 * theme's ink (black in light mode, white in dark) only as far as it takes to carry
 * text on bright paper and bright paper text on it (4.5:1). Null for a value that is
 * not a hex colour.
 */
export function accentFor(hue: string, dark: boolean): string | null {
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hue)) return null;
  const base = pageMarkColor(hue, dark);
  const paper = dark ? SURFACE_BRIGHT.dark : SURFACE_BRIGHT.light;
  for (let t = 0; t <= 1; t += 0.05) {
    const accent = mixHex(base, dark ? "#ffffff" : "#000000", t);
    if (contrastRatio(accent, paper) >= 4.5) return accent;
  }
  return null;
}

/**
 * Hands the open draft's heatmap hue to the page: `--color-theme` tints the page
 * ground and `--color-accent` colours the wordmark, selected segments, the active
 * tab and grid focus (see globals.css). Colour by contributor draws no single hue,
 * so the page goes back to plain paper and the accent to primary. Only the web
 * interface reads these: exported figures take their colours from the export options.
 */
export function ThemeHue() {
  const monoColor = useContributionStore((state) => state.heatmapMonoColor);
  // Past eight contributors the grid falls back to the one hue, so the page follows it.
  const perPerson = useContributionStore(
    (state) => state.colorByContributor && contributorHues(state.authors.length) !== null,
  );
  const dark = useDark();
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--color-theme", perPerson ? "var(--color-paper)" : monoColor);
    const accent = perPerson ? null : accentFor(monoColor, dark);
    if (accent) root.setProperty("--color-accent", accent);
    else root.removeProperty("--color-accent");
  }, [monoColor, perPerson, dark]);
  return null;
}
