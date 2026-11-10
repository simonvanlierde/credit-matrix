import { useEffect } from "react";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Hands the open draft's heatmap hue to the page as `--color-theme`, which
 * tints the page ground (see globals.css). Only the web interface reads it:
 * exported figures take their colours from the export options, on white.
 */
export function ThemeHue() {
  const monoColor = useContributionStore((state) => state.heatmapMonoColor);
  useEffect(() => {
    document.documentElement.style.setProperty("--color-theme", monoColor);
  }, [monoColor]);
  return null;
}
