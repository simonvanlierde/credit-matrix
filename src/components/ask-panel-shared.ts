// Shared by the Team and Review tabs, so the two look and count alike.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `at` (epoch ms) to now; never negative, for a clock that moved back. */
export const daysSince = (at: number) => Math.max(0, Math.floor((Date.now() - at) / DAY_MS));

export const PRIMARY_BUTTON =
  "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";
export const SECONDARY_BUTTON =
  "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-outline-variant px-3 text-xs font-medium text-on-surface transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
