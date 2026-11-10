export interface HeatmapFigureSettings {
  color: string;
  /** One hue for the figure, or each contributor in their own (app exports only). */
  colorBy: "color" | "contributor";
  horizontal: boolean;
  acronyms: boolean;
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
  color: "#1f4e79",
  colorBy: "color",
  horizontal: false,
  acronyms: false,
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
  const boolean = (key: "horizontal" | "acronyms" | "skipempty" | "legend" | "levels" | "marks"): boolean =>
    typeof value[key] === "boolean" ? value[key] : defaults[key];
  return {
    color:
      typeof value.color === "string" && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.color)
        ? value.color
        : defaults.color,
    colorBy: value.colorBy === "contributor" ? "contributor" : defaults.colorBy,
    horizontal: boolean("horizontal"),
    acronyms: boolean("acronyms"),
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
