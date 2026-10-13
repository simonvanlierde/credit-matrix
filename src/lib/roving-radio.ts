import type { KeyboardEvent } from "react";

/**
 * Arrow keys on a radiogroup with a roving tabindex (the WAI-ARIA radio-group
 * pattern): Right/Down and Left/Up move to the next or previous option,
 * wrapping, select it, and move focus to its radio. Attach to the group
 * element, whose `[role="radio"]` children are in `options` order.
 */
export function moveRadioSelection<T>(
  event: KeyboardEvent<HTMLElement>,
  options: readonly T[],
  current: number,
  onChange: (next: T) => void,
) {
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
  if (!(forward || back)) return;
  event.preventDefault();
  const nextIndex = (current + (forward ? 1 : options.length - 1)) % options.length;
  const next = options[nextIndex];
  if (next === undefined) return;
  onChange(next);
  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
}
