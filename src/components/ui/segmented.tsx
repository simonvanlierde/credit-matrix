import type { ReactNode } from "react";
import { moveRadioSelection } from "@/lib/roving-radio";
import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional accessible label when `label` is an icon/swatch. */
  title?: string;
}

/**
 * A pill-group segmented control: the app's standard for picking one of a few
 * mutually exclusive options (input mode, statement format, heatmap colors).
 *
 * Implemented as a radiogroup: one tab stop, arrow keys move between (and select)
 * options, per the WAI-ARIA radio-group pattern.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  const selected = options.findIndex((option) => option.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(event) => moveRadioSelection(event, options, selected, (next) => onChange(next.value))}
      className={cn("inline-flex overflow-hidden rounded border border-edge bg-surface-bright", className)}
    >
      {options.map(({ value: optionValue, label, title }, index) => {
        const active = value === optionValue;
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled pill buttons, not native <input type="radio">; role=radio + roving tabindex is the intended pattern.
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={active}
            // With nothing selected, the first radio keeps the group in the tab order.
            tabIndex={active || (selected === -1 && index === 0) ? 0 : -1}
            title={title}
            onClick={() => onChange(optionValue)}
            className={cn(
              "flex items-center justify-center gap-1.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
              // The group clips overflow, so touch grows the option itself.
              "pointer-coarse:min-h-11",
              // Forced colours would repaint the fill as Canvas under Canvas text, a blank box: opt out and
              // invert. Not Highlight: Firefox and WebKit emulate it at 2.94:1.
              active
                ? "bg-accent text-on-accent forced-colors:bg-[CanvasText] forced-colors:text-[Canvas] forced-colors:[forced-color-adjust:none]"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
