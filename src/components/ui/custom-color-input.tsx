import { useEffect, useRef } from "react";
import { hexRgb } from "@/core/contributor-color";

/**
 * The native picker, uncontrolled. Dragging in it fires `input` on every step,
 * and each store write repaints every grid cell and saves the draft, so only
 * the committed pick (the native `change` event) reaches `onChange`. The
 * picker's own swatch still follows the drag. Closing the settings can unmount
 * the input before a still-open picker fires `change`, so unmounting commits
 * the last value shown too.
 */
export function CustomColorInput({
  id,
  value: color,
  onChange,
  className,
}: {
  id: string;
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  // Native color inputs require six digits; stored drafts also allow #rgb.
  const value = `#${hexRgb(color)
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
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
      if (input.value.toLowerCase() !== latest.current.value.toLowerCase()) {
        latest.current.value = input.value;
        latest.current.onChange(input.value);
      }
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
      className={`size-6 shrink-0 cursor-pointer rounded border border-outline-variant bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className ?? ""}`}
    />
  );
}
