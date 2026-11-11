import { Check } from "lucide-react";
import { type ReactNode, useId } from "react";
import { CONTRIBUTOR_HUES, onColor as inkOn } from "@/core/contributor-color";
import { useTranslations } from "@/lib/translations";
import { ColorPopover } from "./color-popover";
import { SegmentedControl } from "./segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Switch } from "./switch";

/**
 * The shared vocabulary of the app's settings panels (heatmap view, figure,
 * statement, language): a title row with Reset, short semibold section labels,
 * switches on the right, segmented controls for two or three options, a select
 * for more, and one swatch row for colour.
 */
export function SettingsPanel({
  title,
  titleLang,
  onReset,
  children,
}: {
  title: string;
  titleLang?: string;
  /** Omit when the panel has no sensible default to return to. */
  onReset?: () => void;
  children: ReactNode;
}) {
  const t = useTranslations();
  return (
    <div className="grid content-start gap-3 text-xs text-on-surface">
      <div className="flex items-center justify-between gap-3">
        <p lang={titleLang} className="text-sm font-semibold">
          {title}
        </p>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="hit-area rounded px-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("settingsReset")}
          </button>
        )}
      </div>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}

/** A group of related settings under a short sentence-case label. After the first group, a rule divides them. */
export function SettingsSection({
  label,
  aside,
  children,
}: {
  label?: string;
  /** A short state beside the label, such as the colour in use. */
  aside?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset
      aria-labelledby={label ? id : undefined}
      className="m-0 grid min-w-0 gap-2 border-0 p-0 not-first:border-t not-first:border-outline-variant/40 not-first:pt-3"
    >
      {label && (
        <div className="flex items-baseline justify-between gap-3">
          <p id={id} className="text-xs font-semibold">
            {label}
          </p>
          {aside && <span className="truncate text-on-surface-variant">{aside}</span>}
        </div>
      )}
      {children}
    </fieldset>
  );
}

/** An on/off setting: label left, switch right, the whole row the label. */
export function SettingSwitch({
  label,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Must start with the visible label, so voice control saying the label hits it (2.5.3). */
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-9 cursor-pointer items-center justify-between gap-3 text-xs">
      {label}
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={ariaLabel} />
    </label>
  );
}

/** One of a few options: segmented for up to three, a select for more. */
export function SettingChoice<T extends string>({
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
      <span id={id} className="text-on-surface-variant">
        {label}
      </span>
      {options.length <= 3 ? (
        <SegmentedControl
          size="sm"
          ariaLabel={label}
          className="w-fit max-w-full"
          value={value}
          onChange={onChange}
          options={options.map(([key, text]) => ({ value: key, label: text }))}
        />
      ) : (
        <Select value={value} onValueChange={(next) => onChange(next as T)}>
          <SelectTrigger aria-labelledby={id} className="min-h-9 w-full">
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
      )}
    </div>
  );
}

const SWATCH =
  "hit-area relative flex size-6 items-center justify-center rounded-full border border-outline-variant/50 ring-offset-1 ring-offset-surface-bright transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-pressed:ring-2 aria-pressed:ring-on-surface forced-colors:aria-pressed:ring-[Highlight]";

/** The hues offered beside "Per contributor" and "Custom". */
const PRESET_HUES = ["#1f4e79", "#00724c", "#404040"] as const;

/**
 * The colour setting: a "Per contributor" swatch first, the preset hues, then a
 * custom picker. A pressed swatch shows a ring and a check, so colour is never
 * the only cue, and the chosen one is named beside the section label.
 */
export function ColorSwatches({
  label,
  color,
  perContributor,
  onColor,
  onPerContributor,
}: {
  label: string;
  color: string;
  perContributor: boolean;
  onColor: (hex: string) => void;
  onPerContributor: () => void;
}) {
  const t = useTranslations();
  const presets: [string, string][] = [
    [PRESET_HUES[0], t("heatmapBlue")],
    [PRESET_HUES[1], t("heatmapGreen")],
    [PRESET_HUES[2], t("heatmapGray")],
  ];
  const preset = presets.find(([hex]) => hex === color.toLowerCase());
  const custom = !perContributor && !preset;
  const active = perContributor ? t("figurePerContributor") : (preset?.[1] ?? color);
  return (
    <SettingsSection label={label} aside={active}>
      <div className="flex items-center gap-2.5 py-1">
        <button
          type="button"
          aria-pressed={perContributor}
          aria-label={t("figurePerContributor")}
          title={t("figurePerContributor")}
          onClick={onPerContributor}
          className={SWATCH}
          style={{ background: `conic-gradient(${CONTRIBUTOR_HUES.slice(0, 4).join(", ")})` }}
        >
          {perContributor && <Check className="size-3 text-white drop-shadow" aria-hidden="true" />}
        </button>
        {presets.map(([hex, name]) => {
          const pressed = !perContributor && hex === color.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              aria-pressed={pressed}
              aria-label={name}
              title={name}
              onClick={() => onColor(hex)}
              className={SWATCH}
              style={{ backgroundColor: hex }}
            >
              {pressed && <Check className="size-3" style={{ color: inkOn(hex) }} aria-hidden="true" />}
            </button>
          );
        })}
        <ColorPopover
          value={color}
          onChange={onColor}
          label={t("customColor")}
          trigger={
            <button
              type="button"
              aria-pressed={custom}
              aria-label={t("customColor")}
              title={t("customColor")}
              className={`${SWATCH} ${custom ? "" : "border-dashed"}`}
              style={custom ? { backgroundColor: color } : undefined}
            >
              {custom ? (
                <Check className="size-3" style={{ color: inkOn(color) }} aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className="text-sm leading-none text-on-surface-variant">
                  +
                </span>
              )}
            </button>
          }
        />
      </div>
    </SettingsSection>
  );
}
