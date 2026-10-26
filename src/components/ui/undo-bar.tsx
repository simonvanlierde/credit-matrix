"use client";

import { useId } from "react";
import { useTranslations } from "use-intl";
import { cn } from "@/lib/utils";

/**
 * The undo strip under a destructive action. The two wrappers are the height
 * transition, not layout: the grid row opens from 0fr (see .undo-enter) and
 * the inner div clips what overflows while it does. `className` sets the gap
 * above it.
 *
 * Not a live region: one that mounts with its text already in it is missed by
 * many screen readers. The caller says the message with announce(); the group
 * name tells someone tabbing to Undo what it undoes.
 */
/** How long an undo stays on offer: eight seconds was under WCAG 2.2.1's threshold. */
export const UNDO_WINDOW_MS = 60_000;

export function UndoBar({ message, onUndo, className }: { message: string; onUndo: () => void; className?: string }) {
  const t = useTranslations();
  const messageId = useId();
  return (
    <div className="undo-enter grid">
      <div className="overflow-hidden">
        <fieldset
          aria-labelledby={messageId}
          className={cn(
            "flex min-w-0 items-center justify-between gap-3 rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface",
            className,
          )}
        >
          <span id={messageId} className="min-w-0 truncate">
            {message}
          </span>
          <button
            type="button"
            onClick={onUndo}
            className="shrink-0 rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("undo")}
          </button>
        </fieldset>
      </div>
    </div>
  );
}
