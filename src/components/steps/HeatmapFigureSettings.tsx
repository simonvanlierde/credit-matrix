import { useState } from "react";
import { SettingChoice, SettingSwitch, SettingsPanel, SettingsSection } from "@/components/ui/settings-panel";
import { DEFAULT_HEATMAP_SETTINGS, type HeatmapFigureSettings as FigureSettings } from "@/lib/heatmap-settings";
import { useTranslations } from "@/lib/translations";

export function HeatmapFigureSettings({
  value,
  onChange,
}: {
  value: FigureSettings;
  onChange: (value: FigureSettings) => void;
}) {
  const t = useTranslations();
  const patch = (change: Partial<FigureSettings>) => onChange({ ...value, ...change });
  return (
    <SettingsPanel title={t("heatmapFigureSettings")} onReset={() => onChange({ ...DEFAULT_HEATMAP_SETTINGS })}>
      {/* One home per setting: what the grid shows lives in its options, and the figure draws it. */}
      <p className="text-on-surface-variant">{t("heatmapFollowsGrid")}</p>
      <SettingsSection label={t("heatmapLayout")}>
        <SettingChoice
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
        <SettingChoice
          label={t("heatmapRoleLabels")}
          value={value.labels}
          onChange={(labels) => patch({ labels })}
          options={[
            ["full", t("heatmapFullLabels")],
            ["short", t("heatmapShortLabels")],
          ]}
        />
        <SettingSwitch
          label={t("heatmapHideUnused")}
          checked={value.skipempty}
          onChange={(skipempty) => patch({ skipempty })}
        />
        <SettingSwitch label={t("heatmapShowLevels")} checked={value.levels} onChange={(levels) => patch({ levels })} />
        <SettingSwitch label={t("heatmapCellMarks")} checked={value.marks} onChange={(marks) => patch({ marks })} />
        {!value.legend && <p className="text-on-surface-variant">{t("heatmapLegendHint")}</p>}
      </SettingsSection>
      <details className="border-t border-outline-variant/40 pt-3">
        <summary className="min-h-6 cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {t("heatmapAdvanced")}
        </summary>
        <div className="mt-2 grid gap-2">
          <SettingChoice
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
          <SettingChoice
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
      <SettingsSection label={t("heatmapPngSize")}>
        <FigureNumber
          label={t("heatmapWidthMm")}
          value={value.pngWidthMm}
          min={40}
          max={300}
          onChange={(pngWidthMm) => patch({ pngWidthMm })}
        />
        <SettingChoice
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
      </SettingsSection>
    </SettingsPanel>
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
