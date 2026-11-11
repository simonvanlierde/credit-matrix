import { useEffect } from "react";
import { applyThemeColors } from "@/lib/theme-color";
import { useDark } from "@/lib/use-dark";
import { useHydrated } from "@/lib/use-hydrated";
import { useContributionStore } from "@/store/contribution-store";

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
  const people = useContributionStore((state) => (state.colorByContributor ? state.authors.length : null));
  const dark = useDark();
  const hydrated = useHydrated();
  useEffect(() => {
    if (hydrated) applyThemeColors(document.documentElement.style, monoColor, dark, people);
  }, [monoColor, people, dark, hydrated]);
  return null;
}
