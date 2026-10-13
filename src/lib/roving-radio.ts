import type { KeyboardEvent } from "react";

/**
 * Arrow keys on a radiogroup with a roving tabindex (the WAI-ARIA radio-group
 * pattern): Right/Down and Left/Up move to the next or previous option,
 * wrapping, select it, and move focus to its radio. With nothing selected
 * (`current` is -1) they start from the first or the last option. Arrows with
 * Alt, Ctrl or Meta are left to the browser (Alt+Left is Back). Attach to the
 * group element, whose `[role="radio"]` children are in `options` order.
 */
export function moveRadioSelection<T>(
  event: KeyboardEvent<HTMLElement>,
  options: readonly T[],
  current: number,
  onChange: (next: T) => void,
) {
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
  if (!(forward || back) || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  // From -1, forward lands on 0; back must wrap from 0 to reach the last.
  const from = current === -1 && back ? 0 : current;
  const nextIndex = (from + (forward ? 1 : options.length - 1)) % options.length;
  const next = options[nextIndex];
  if (next === undefined) return;
  onChange(next);
  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
}
