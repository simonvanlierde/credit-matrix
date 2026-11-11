import { contributorHues, pageMarkColor } from "@/core/contributor-color";
import { useDark } from "@/lib/use-dark";
import { useContributionStore } from "@/store/contribution-store";

/**
 * The mark for CRediT Matrix: a 3x3 crop of the contribution matrix, lead on the diagonal.
 * Cells are drawn at the app's three intensity tiers in the workspace's own heatmap
 * hue, or one contributor hue per column when the grid colours by contributor, so
 * the mark is a live swatch of the grid rather than a fixed sticker. The wordmark
 * beside it takes the accent: the same hue where it reaches text contrast, primary
 * where it does not (see ThemeHue).
 *
 * The store skips hydration, so server and first client render both use the
 * default ink-blue; the transition covers the swap to a stored hue.
 *
 * The favicon (`src/app/icon.svg`) has the same geometry with literal fills.
 */
/** Fill opacity per cell, row by row: lead on the diagonal, the app's three intensity tiers around it. */
const MARK_LEVELS = [
  [1, 0.62, 0.32],
  [0.62, 1, 0.12],
  [0.32, 0.12, 1],
] as const;

export function BrandMark({ className }: { className?: string }) {
  const monoColor = useContributionStore((state) => state.heatmapMonoColor);
  // With colour by contributor, each column is a person, so it takes their hue.
  // A number, not the array: a fresh array per read would re-render on every store change.
  const people = useContributionStore((state) => (state.colorByContributor ? state.authors.length : 0));
  const hues = people > 0 ? contributorHues(people) : null;
  // The raw hue and its faded tiers vanish on the dark header; use its dark-ramp lead.
  const dark = useDark();
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      style={{ color: pageMarkColor(monoColor, dark), transition: "color 200ms ease-out" }}
      aria-hidden="true"
      focusable="false"
    >
      {MARK_LEVELS.map((row, r) =>
        row.map((opacity, c) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed 3x3 grid
            key={`${r}-${c}`}
            x={3 + c * 9}
            y={3 + r * 9}
            width="8"
            height="8"
            rx="1"
            fill={hues?.[c] ? pageMarkColor(hues[c], dark) : "currentColor"}
            fillOpacity={opacity === 1 ? undefined : opacity}
          />
        )),
      )}
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
 * of controls at their 44px touch size. Below that the mark shows the brand
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
        className="hidden min-[27rem]:inline whitespace-nowrap font-headline text-lg italic font-semibold tracking-tight text-accent transition-colors duration-200 sm:text-xl"
        style={{ fontFamily: "var(--font-headline)" }}
      >
        {PRODUCT_NAME}
      </span>
    </>
  );
}
