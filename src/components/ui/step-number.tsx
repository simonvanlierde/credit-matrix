import { cn } from "@/lib/utils";

/**
 * The numbered badge that marks a workflow step. The panels form a real
 * sequence: contributors (1) → roles (2) → output (3), so the numbering is
 * honest wayfinding. Decorative to assistive tech: the heading beside it gives
 * the accessible name, and the welcome card's ordered list conveys the sequence.
 */
export function StepNumber({ n, className }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary",
        className,
      )}
    >
      {n}
    </span>
  );
}
