import { useContributionStore } from "@/store/contribution-store";

/**
 * The mark for CRediT Matrix: a 3x3 crop of the contribution matrix, lead on the diagonal.
 * Cells are drawn in `currentColor` at the app's three intensity tiers, and the
 * color is the workspace's own heatmap hue, so the mark is a live swatch of the
 * grid rather than a fixed sticker. The wordmark beside it stays on the primary
 * token: a hue is chosen for cell legibility, and some of the presets would not
 * carry text contrast.
 *
 * The store skips hydration, so server and first client render both use the
 * default ink-blue; the transition covers the swap to a stored hue.
 *
 * The favicon (`src/app/icon.svg`) carries the same geometry with literal fills.
 */
export function BrandMark({ className }: { className?: string }) {
  const monoColor = useContributionStore((state) => state.heatmapMonoColor);
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      style={{ color: monoColor, transition: "color 200ms ease-out" }}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="12" y="3" width="8" height="8" rx="1" fillOpacity="0.62" />
        <rect x="21" y="3" width="8" height="8" rx="1" fillOpacity="0.32" />
        <rect x="3" y="12" width="8" height="8" rx="1" fillOpacity="0.62" />
        <rect x="12" y="12" width="8" height="8" rx="1" />
        <rect x="21" y="12" width="8" height="8" rx="1" fillOpacity="0.12" />
        <rect x="3" y="21" width="8" height="8" rx="1" fillOpacity="0.32" />
        <rect x="12" y="21" width="8" height="8" rx="1" fillOpacity="0.12" />
        <rect x="21" y="21" width="8" height="8" rx="1" />
      </g>
    </svg>
  );
}

export const PRODUCT_NAME = "CRediT Matrix";

/**
 * The lockup: the mark at cap height, a gap, then the wordmark. One source of
 * truth, so the header's plain lockup and the mobile brand menu that wraps the
 * same marks in a trigger can never drift apart.
 *
 * The wordmark never wraps and never shrinks: a two-line brand overflows the
 * 52px header, and a squeezed one stops being the wordmark. It appears only from
 * 27rem, where the row measurably has the ~171px the lockup needs beside 232px
 * of controls at their 44px touch size. Below that the mark carries the brand
 * alone, and the menu it opens names the product on its first line.
 */
export function Lockup() {
  return (
    <>
      <BrandMark className="h-[1.15rem] w-[1.15rem] shrink-0 sm:h-[1.3rem] sm:w-[1.3rem]" />
      {/* Where the wordmark is not drawn the name is still said: the mark is
          decorative, so without this the <h1> and the menu button it wraps have
          no accessible name at all. */}
      <span className="sr-only min-[27rem]:hidden">{PRODUCT_NAME}</span>
      <span
        className="hidden min-[27rem]:inline whitespace-nowrap font-headline text-lg italic font-semibold tracking-tight sm:text-xl"
        style={{ fontFamily: "var(--font-headline)" }}
      >
        {PRODUCT_NAME}
      </span>
    </>
  );
}
