"use client";

import { useTranslations } from "use-intl";
import { cn } from "@/lib/utils";

/**
 * The undo strip under a destructive action. The two wrappers are the height
 * transition, not layout: the grid row opens from 0fr (see .undo-enter) and
 * the inner div clips what overflows while it does. `className` sets the gap
 * above it.
 */
export function UndoBar({ message, onUndo, className }: { message: string; onUndo: () => void; className?: string }) {
  const t = useTranslations();
  return (
    <div className="undo-enter grid">
      <div className="overflow-hidden">
        <div
          role="status"
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface",
            className,
          )}
        >
          <span className="min-w-0 truncate">{message}</span>
          <button
            type="button"
            onClick={onUndo}
            className="shrink-0 rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("undo")}
          </button>
        </div>
      </div>
    </div>
  );
}
