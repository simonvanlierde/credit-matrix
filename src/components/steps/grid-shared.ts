import { LEVEL_SCORE } from "@/core/author";
import type { UiKey } from "@/core/i18n";

/** The levels as legend keys, descending (lead→none). */
export const LEVEL_KEY: { key: UiKey; score: number }[] = Object.entries(LEVEL_SCORE)
  .map(([key, score]) => ({ key: key as UiKey, score }))
  .reverse();

export const ICON_TOOL_BUTTON =
  "flex size-9 items-center justify-center rounded-lg border border-outline-variant/60 text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:border-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary";
export const MENU_ITEM =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-on-surface-variant/60";
