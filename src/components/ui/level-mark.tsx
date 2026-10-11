import { Check } from "lucide-react";
import { scoreToLevel } from "@/core";

const LEVEL_DOTS: Record<string, number> = { supporting: 1, equal: 2, lead: 3 };

/**
 * What an assigned cell shows. Yes/no mode keeps the check; Levels mode counts
 * the level in dots (1 supporting, 2 equal, 3 lead), so the level never rests
 * on fill lightness alone (WCAG 1.4.1). `color` must come from onColor so the
 * mark clears 3:1 against its fill (WCAG 1.4.11).
 */
export function LevelMark({
  score,
  graded,
  color,
  size = "cell",
}: {
  score: number;
  graded: boolean;
  color: string;
  size?: "cell" | "small";
}) {
  if (!graded) return <Check aria-hidden="true" className="size-3.5" style={{ color }} strokeWidth={3} />;
  const dots = LEVEL_DOTS[scoreToLevel(score)] ?? 0;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${dots * 6 - 1} 5`}
      className={size === "cell" ? "h-1.5 w-auto" : "h-1 w-auto"}
      style={{ color }}
    >
      {Array.from({ length: dots }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the dots are identical and never reorder.
        <circle key={i} cx={2.5 + i * 6} cy={2.5} r={2.5} fill="currentColor" />
      ))}
    </svg>
  );
}
