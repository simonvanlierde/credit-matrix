"use client";

import { OKABE_ITO, onColor } from "@credit-generator/core";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * Human names for the Okabe–Ito swatches, keyed by hex: a screen reader can do
 * nothing with "Set color #f0e442".
 */
const OKABE_ITO_NAME_KEYS = {
  "#0072b2": "colorBlue",
  "#e69f00": "colorOrange",
  "#009e73": "colorBluishGreen",
  "#cc79a7": "colorReddishPurple",
  "#d55e00": "colorVermilion",
  "#56b4e9": "colorSkyBlue",
  "#f0e442": "colorYellow",
  "#404040": "colorDarkGray",
} as const;

/**
 * A small color picker in a popover: the Okabe–Ito swatches and a native custom
 * picker. `trigger` is the clickable element that opens it.
 */
export function ColorPopover({
  value,
  onChange,
  trigger,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  trigger: ReactNode;
  label: string;
}) {
  const t = useTranslations();
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-56">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</p>
        <div className="grid grid-cols-8 gap-1.5">
          {OKABE_ITO.map((hex) => {
            const selected = hex.toLowerCase() === value.toLowerCase();
            const name = t(OKABE_ITO_NAME_KEYS[hex]);
            return (
              <button
                key={hex}
                type="button"
                onClick={() => onChange(hex)}
                title={`${name} (${hex})`}
                aria-label={t("a11ySetColor", { color: name })}
                aria-pressed={selected}
                className="flex size-6 items-center justify-center rounded-full ring-offset-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{ backgroundColor: hex }}
              >
                {selected && <Check className="h-3 w-3" style={{ color: onColor(hex) }} />}
              </button>
            );
          })}
        </div>
        <label className="mt-3 flex items-center gap-1.5 text-xs text-on-surface-variant">
          <input
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={t("a11yCustomColor")}
            className="h-6 w-6 cursor-pointer rounded border border-outline-variant bg-transparent p-0"
          />
          {t("customColor")}
        </label>
      </PopoverContent>
    </Popover>
  );
}
