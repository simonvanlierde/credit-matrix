import { useId, useState } from "react";
import { ColorPopover } from "@/components/ui/color-popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { contrastRatio, heatCellColor } from "@/core/contributor-color";
import { DEFAULT_HEATMAP_SETTINGS, type HeatmapFigureSettings as FigureSettings } from "@/lib/heatmap-settings";
import { useTranslations } from "@/lib/translations";
import { TOOL_BUTTON } from "./grid-shared";

export function HeatmapFigureSettings({
  value,
  onChange,
}: {
  value: FigureSettings;
  onChange: (value: FigureSettings) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const patch = (change: Partial<FigureSettings>) => onChange({ ...value, ...change });
  const pale =
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.color) &&
    contrastRatio(heatCellColor(value.color, 33), heatCellColor(value.color, 0)) < 1.5;
  return (
    <div className="grid content-start gap-4 text-xs text-on-surface">
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-semibold">{t("heatmapLayout")}</legend>
        <FigureChoice
          label={t("heatmapOrientation")}
          value={value.horizontal ? "contributors" : "roles"}
          onChange={(next) => patch({ horizontal: next === "contributors" })}
          options={[
            ["roles", t("heatmapRolesInRows")],
            ["contributors", t("heatmapContributorsInRows")],
          ]}
        />
        <FigureChoice
          label={t("heatmapLegendPosition")}
          value={value.legend ? value.legendPosition : "hidden"}
          onChange={(position) =>
            patch(position === "hidden" ? { legend: false } : { legend: true, legendPosition: position })
          }
          options={[
            ["auto", t("heatmapLegendAuto")],
            ["right", t("heatmapLegendRight")],
            ["bottom", t("heatmapLegendBelow")],
            ["hidden", t("heatmapLegendHidden")],
          ]}
        />
        <FigureChoice
          label={t("heatmapRoleLabels")}
          value={value.labels}
          onChange={(labels) => patch({ labels })}
          options={[
            ["full", t("heatmapFullLabels")],
            ["short", t("heatmapShortLabels")],
          ]}
        />
        {(
          [
            ["acronyms", t("useInitials")],
            ["skipempty", t("heatmapHideUnused")],
            ["levels", t("heatmapShowLevels")],
            ["marks", t("heatmapCellMarks")],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            htmlFor={`${id}-${key}`}
            className="flex min-h-9 cursor-pointer items-center justify-between gap-3"
          >
            {label}
            <Switch id={`${id}-${key}`} checked={value[key]} onCheckedChange={(checked) => patch({ [key]: checked })} />
          </label>
        ))}
        {!value.legend && <p className="text-on-surface-variant">{t("heatmapLegendHint")}</p>}
        {!value.marks && <p className="text-on-surface-variant">{t("heatmapMarksHint")}</p>}
      </fieldset>
      <fieldset className="grid gap-2 border-t border-outline-variant/40 pt-3">
        <legend className="font-semibold">{t("colorLabel")}</legend>
        <FigureChoice
          label={t("figureColor")}
          value={value.colorBy}
          onChange={(colorBy) => patch({ colorBy })}
          options={[
            ["color", t("figureOneColor")],
            ["contributor", t("figurePerContributor")],
          ]}
        />
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          {(
            [
              ["#1f4e79", t("heatmapBlue")],
              ["#00724c", t("heatmapGreen")],
              ["#404040", t("heatmapGray")],
            ] as const
          ).map(([color, label]) => (
            <button
              key={color}
              type="button"
              className={`${TOOL_BUTTON} justify-start px-2 aria-pressed:border-primary aria-pressed:text-primary`}
              aria-pressed={value.color.toLowerCase() === color}
              onClick={() => patch({ color })}
            >
              <span aria-hidden="true" className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
              {label}
            </button>
          ))}
          <ColorPopover
            value={value.color}
            onChange={(color) => patch({ color })}
            label={t("customColor")}
            trigger={
              <button type="button" className={`${TOOL_BUTTON} px-2`}>
                {t("customColor")}
              </button>
            }
          />
        </div>
        {pale && <p className="text-on-surface-variant">{t("heatmapPaleColor")}</p>}
      </fieldset>
      <details className="border-t border-outline-variant/40 pt-3">
        <summary className="min-h-6 cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {t("heatmapAdvanced")}
        </summary>
        <div className="mt-2 grid gap-2">
          <FigureChoice
            label={t("heatmapFont")}
            value={value.font}
            onChange={(font) => patch({ font })}
            options={[
              ["sans", t("heatmapSans")],
              ["serif", t("heatmapSerif")],
            ]}
          />
          <FigureNumber
            label={t("heatmapFontSize")}
            value={value.fontSize}
            min={6}
            max={32}
            step={0.5}
            onChange={(fontSize) => patch({ fontSize })}
          />
          <FigureChoice
            label={t("heatmapCellShape")}
            value={value.shape}
            onChange={(shape) => patch({ shape })}
            options={[
              ["square", t("heatmapSquare")],
              ["rounded", t("heatmapRounded")],
              ["circle", t("heatmapCircle")],
            ]}
          />
          <FigureNumber
            label={t("heatmapCellSize")}
            value={value.size}
            min={8}
            max={48}
            onChange={(size) => patch({ size })}
          />
        </div>
      </details>
      <fieldset className="grid gap-2 border-t border-outline-variant/40 pt-3">
        <legend className="font-semibold">{t("heatmapPngSize")}</legend>
        <FigureNumber
          label={t("heatmapWidthMm")}
          value={value.pngWidthMm}
          min={40}
          max={300}
          onChange={(pngWidthMm) => patch({ pngWidthMm })}
        />
        <FigureChoice
          label={t("heatmapResolution")}
          value={String(value.pngDpi)}
          onChange={(dpi) => patch({ pngDpi: Number(dpi) as FigureSettings["pngDpi"] })}
          options={[
            ["150", "150 dpi"],
            ["300", "300 dpi"],
            ["600", "600 dpi"],
          ]}
        />
        <p className="text-on-surface-variant">{t("heatmapSvgHint")}</p>
      </fieldset>
      <button
        type="button"
        className={`${TOOL_BUTTON} justify-center`}
        onClick={() => onChange({ ...DEFAULT_HEATMAP_SETTINGS })}
      >
        {t("heatmapReset")}
      </button>
    </div>
  );
}

function FigureChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-on-surface-variant">
        {label}
      </label>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id} className="min-h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FigureNumber({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const valid =
    draft === null ||
    (draft.trim() !== "" && Number.isFinite(Number(draft)) && Number(draft) >= min && Number(draft) <= max);
  return (
    <label className="grid gap-1 text-on-surface-variant">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft ?? value}
        aria-invalid={!valid || undefined}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (text.trim() && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max)
            onChange(Number(text));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="min-h-9 w-full rounded border border-outline-variant bg-surface-bright px-2 text-xs tabular-nums text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary aria-invalid:border-error"
      />
    </label>
  );
}
