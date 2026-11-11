import { useEffect } from "react";
import { contrastRatio, contributorHues, HEX_COLOR, mixHex, pageMarkColor } from "@/core/contributor-color";
import { useDark } from "@/lib/use-dark";
import { useContributionStore } from "@/store/contribution-store";

/** The page and card grounds per theme (globals.css): the page is paper tinted with the hue. */
const GROUND = {
  light: { paper: "#fbf8f1", tint: 0.03, bright: "#fffdf8" },
  dark: { paper: "#161513", tint: 0.04, bright: "#24221f" },
};

/**
 * The accent for a heatmap hue: the hue as the mark draws it, deepened toward the
 * theme's ink (black in light mode, white in dark) only as far as it takes to reach
 * 4.5:1 for text on every ground it sits on: bright paper (and bright paper text on
 * it), the hue-tinted page, and the initials chip's own 10% accent wash over the page.
 * Null for a value that is not a hex colour.
 */
export function accentFor(hue: string, dark: boolean): string | null {
  if (!HEX_COLOR.test(hue)) return null;
  const base = pageMarkColor(hue, dark);
  const ground = dark ? GROUND.dark : GROUND.light;
  const page = mixHex(ground.paper, hue, ground.tint);
  for (let t = 0; t <= 1; t += 0.05) {
    const accent = mixHex(base, dark ? "#ffffff" : "#000000", t);
    const grounds = [ground.bright, page, mixHex(page, accent, 0.1)];
    if (grounds.every((g) => contrastRatio(accent, g) >= 4.5)) return accent;
  }
  return null;
}

/**
 * Hands the open draft's heatmap hue to the page: `--color-theme` tints the page
 * ground and `--color-accent` colours the wordmark, selected segments, the active
 * tab and grid focus (see globals.css). Primary actions and links share that accent.
 * Colour by contributor draws no single hue, so the page goes back to plain paper
 * and the accent to ink blue. Only the web
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
    if (accent) {
      root.setProperty("--color-accent", accent);
      root.setProperty("--color-primary", accent);
      root.setProperty("--color-primary-hover", mixHex(accent, dark ? "#ffffff" : "#000000", 0.12));
    } else {
      root.removeProperty("--color-accent");
      root.removeProperty("--color-primary");
      root.removeProperty("--color-primary-hover");
    }
  }, [monoColor, perPerson, dark]);
  return null;
}
