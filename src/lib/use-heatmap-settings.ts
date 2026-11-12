import { useMemo } from "react";
import { DEFAULT_HEATMAP_SETTINGS, type HeatmapOptions } from "@/lib/heatmap-settings";
import { useContributionStore } from "@/store/contribution-store";

/**
 * The active draft's figure options: the stored figure settings over the defaults, with colour,
 * orientation and initials from the grid. `showLevels` is the default for an untouched `levels`,
 * so it follows the grid's assignment mode until someone sets it.
 */
export function useHeatmapSettings(showLevels: boolean): HeatmapOptions {
  const storedSettings = useContributionStore((s) => s.heatmapSettings);
  const color = useContributionStore((s) => s.heatmapMonoColor);
  const colorByContributor = useContributionStore((s) => s.colorByContributor);
  const horizontal = useContributionStore((s) => s.transpose);
  const acronyms = useContributionStore((s) => s.initials);
  return useMemo(
    () => ({
      ...DEFAULT_HEATMAP_SETTINGS,
      levels: showLevels,
      ...storedSettings,
      color,
      colorBy: colorByContributor ? "contributor" : "color",
      horizontal,
      acronyms,
    }),
    [storedSettings, showLevels, color, colorByContributor, horizontal, acronyms],
  );
}
