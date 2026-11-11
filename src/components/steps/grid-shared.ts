import { LEVEL_SCORE } from "@/core/author";
import type { UiKey } from "@/core/i18n";

/** The levels as legend keys, descending (lead→none). */
export const LEVEL_KEY: { key: UiKey; score: number }[] = Object.entries(LEVEL_SCORE)
  .map(([key, score]) => ({ key: key as UiKey, score }))
  .reverse();

export const ICON_TOOL_BUTTON =
  "hit-area flex size-9 items-center justify-center rounded border border-edge bg-surface-bright text-on-surface transition-[color,box-shadow] hover:text-primary hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:border-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary";
/** The small outlined text buttons beside the grid: colour, transpose and export. */
export const TOOL_BUTTON =
  "hit-area flex min-h-9 items-center gap-1.5 rounded border border-edge bg-surface-bright px-3 text-[13px] font-medium text-on-surface transition-[color,box-shadow] hover:text-primary hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:border-outline disabled:text-on-surface-variant/60 disabled:shadow-none disabled:hover:text-on-surface-variant/60 data-[state=open]:border-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary";
/** The outlined export buttons beside Copy statement, a step larger than the grid's. */
export const EXPORT_BUTTON =
  "flex min-h-10 items-center gap-1.5 rounded border border-edge bg-surface-bright px-3 text-sm font-medium text-on-surface transition-[color,box-shadow] hover:shadow-card hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:border-outline-variant/40 disabled:text-on-surface-variant/60 data-[state=open]:border-primary data-[state=open]:text-primary";
/** A row in a menu or popover; `MenuItem` adds the disabled-but-focusable state. */
export const MENU_ITEM =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-on-surface-variant/60";
