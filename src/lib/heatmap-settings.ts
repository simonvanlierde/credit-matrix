/**
 * What the grid and the figure share. Stored once per draft beside the grid
 * (hue, per-contributor colour, orientation, initials), never inside the
 * figure settings, so the two panels cannot disagree.
 */
interface HeatmapViewSettings {
  color: string;
  /** One hue for the figure, or each contributor in their own (app exports only). */
  colorBy: "color" | "contributor";
  horizontal: boolean;
  acronyms: boolean;
}

/** Figure-only options: how the figure is laid out, labelled and sized. */
export interface HeatmapFigureSettings {
  labels: "full" | "short";
  skipempty: boolean;
  legend: boolean;
  legendPosition: "auto" | "right" | "bottom";
  marks: boolean;
  shape: "square" | "rounded" | "circle";
  size: number;
  fontSize: number;
  font: "sans" | "serif";
  levels: boolean;
  pngWidthMm: number;
  pngDpi: 150 | 300 | 600;
}

export const DEFAULT_HEATMAP_SETTINGS: HeatmapFigureSettings = {
  labels: "full",
  skipempty: true,
  legend: true,
  legendPosition: "auto",
  marks: false,
  shape: "square",
  size: 22,
  fontSize: 10.5,
  font: "sans",
  levels: true,
  pngWidthMm: 85,
  pngDpi: 300,
};

/** The figure settings with the grid's shared view: everything the renderer and the recipes take. */
export type HeatmapOptions = HeatmapFigureSettings & HeatmapViewSettings;

/** Repair browser-only figure preferences without changing contribution data. */
export function repairHeatmapSettings(input: unknown): HeatmapFigureSettings | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const defaults = DEFAULT_HEATMAP_SETTINGS;
  const number = (key: "size" | "fontSize" | "pngWidthMm", min: number, max: number): number => {
    const candidate = value[key];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min && candidate <= max
      ? candidate
      : defaults[key];
  };
  const boolean = (key: "skipempty" | "legend" | "levels" | "marks"): boolean =>
    typeof value[key] === "boolean" ? value[key] : defaults[key];
  return {
    labels: value.labels === "short" ? "short" : defaults.labels,
    skipempty: boolean("skipempty"),
    legend: boolean("legend"),
    legendPosition:
      value.legendPosition === "right" || value.legendPosition === "bottom"
        ? value.legendPosition
        : defaults.legendPosition,
    marks: boolean("marks"),
    shape: value.shape === "rounded" || value.shape === "circle" ? value.shape : defaults.shape,
    size: number("size", 8, 48),
    fontSize: number("fontSize", 6, 32),
    font: value.font === "serif" ? "serif" : defaults.font,
    levels: boolean("levels"),
    pngWidthMm: number("pngWidthMm", 40, 300),
    pngDpi: value.pngDpi === 150 || value.pngDpi === 600 ? value.pngDpi : defaults.pngDpi,
  };
}
