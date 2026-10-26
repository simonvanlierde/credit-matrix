"use client";

import { Check } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslations } from "use-intl";
import { OKABE_ITO, onColor } from "@/core/contributor-color";
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
  const customId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent aria-label={label} className="w-56">
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
        <label htmlFor={customId} className="mt-3 flex items-center gap-1.5 text-xs text-on-surface-variant">
          <CustomColorInput id={customId} value={value} onChange={onChange} />
          {t("customColor")}
        </label>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The native picker, uncontrolled. Dragging in it fires `input` on every step,
 * and each store write repaints every grid cell and saves the draft, so only
 * the committed pick (the native `change` event) reaches `onChange`. The
 * picker's own swatch still follows the drag. Closing the popover can unmount
 * the input before a still-open picker fires `change`, so unmounting commits
 * the last value shown too.
 */
function CustomColorInput({ id, value, onChange }: { id: string; value: string; onChange: (hex: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onChange });
  // A swatch picked elsewhere still shows here.
  useEffect(() => {
    latest.current = { value, onChange };
    if (ref.current) ref.current.value = value;
  }, [value, onChange]);
  // React's onChange is the `input` event; the native `change` is the commit.
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const commit = () => {
      if (input.value.toLowerCase() !== latest.current.value.toLowerCase()) latest.current.onChange(input.value);
    };
    input.addEventListener("change", commit);
    return () => {
      input.removeEventListener("change", commit);
      commit();
    };
  }, []);
  return (
    <input
      ref={ref}
      id={id}
      type="color"
      defaultValue={value}
      className="h-6 w-6 cursor-pointer rounded border border-outline-variant bg-transparent p-0"
    />
  );
}
