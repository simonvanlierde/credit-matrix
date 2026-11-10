import { normalizeLocaleCode } from "@/core/credit-i18n";
import { type HeatmapFigureSettings, repairHeatmapSettings } from "./heatmap-settings";

export type HeatmapRecipeTarget = "cli" | "sphinx" | "quarto" | "myst" | "typst";

/** Style-only recipes use fixed data placeholders and validated values, never contributor names. */
export function heatmapRecipe(settings: HeatmapFigureSettings, target: HeatmapRecipeTarget, language: string): string {
  const s = repairHeatmapSettings(settings);
  if (!s) throw new TypeError("Missing figure settings");
  const locale = normalizeLocaleCode(language);
  const options = {
    color: s.color,
    shape: s.shape,
    size: s.size,
    font: s.font,
    "font-size": s.fontSize,
    initials: s.acronyms,
    legend: s.legend,
    "legend-position": s.legendPosition,
    marks: s.marks,
    labels: s.labels,
    levels: s.levels,
    horizontal: s.horizontal,
    skipempty: s.skipempty,
  };
  if (target === "cli") {
    const args = Object.entries({ ...options, locale }).flatMap(([key, value]) => {
      if (key === "horizontal") return value ? ["--horizontal"] : [];
      if (key === "levels") return value ? [] : ["--yes-no"];
      return [`--${key}`, key === "color" ? `'${value}'` : String(value)];
    });
    return `credit-matrix convert contributors.json --to svg ${args.join(" ")} > heatmap.svg`;
  }
  if (target === "typst") {
    const native = {
      ...options,
      color: `rgb("${s.color}")`,
      size: `${s.size * 0.75}pt`,
      "font-size": `${s.fontSize * 0.75}pt`,
      lang: locale,
    };
    const entries = Object.entries(native).map(
      ([key, value]) =>
        `  ${key}: ${typeof value === "string" && !["color", "size", "font-size"].includes(key) ? JSON.stringify(value) : value},`,
    );
    return `#credit-heatmap(team,\n${entries.join("\n")}\n)`;
  }
  if (target === "quarto") {
    return [
      "credit-matrix:",
      "  heatmap: true",
      ...Object.entries({ ...options, locale }).map(
        ([key, value]) => `  ${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`,
      ),
    ].join("\n");
  }
  const entries = Object.entries(target === "myst" ? { ...options, levels: false } : { ...options, locale });
  const body = entries.flatMap(([key, value]) => {
    if (target === "sphinx" && key === "horizontal") return value ? ["   :horizontal:"] : [];
    return [`${target === "sphinx" ? "   " : ""}:${key}: ${value}`];
  });
  return target === "myst"
    ? [":::{credit-heatmap}", ...body, ":::"].join("\n")
    : [".. credit-heatmap:: contributors.json", ...body].join("\n");
}
