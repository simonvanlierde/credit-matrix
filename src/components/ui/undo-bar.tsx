import { useId, useLayoutEffect, useRef } from "react";
import { useTranslations } from "@/lib/translations";
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
 *
 * Unmounting a focused strip would drop focus to <body>, so `onFocusLost`
 * names where it goes instead.
 */
export function UndoBar({
  message,
  onUndo,
  onFocusLost,
  className,
}: {
  message: string;
  onUndo: () => void;
  onFocusLost: () => void;
  className?: string;
}) {
  const t = useTranslations();
  const messageId = useId();
  const ref = useRef<HTMLFieldSetElement>(null);
  // Read through a ref so the cleanup sees the latest callback, not the first.
  const focusLost = useRef(onFocusLost);
  focusLost.current = onFocusLost;
  // A layout cleanup runs before React removes the strip's DOM, so the focused
  // button is still there to be found.
  useLayoutEffect(() => {
    const bar = ref.current;
    return () => {
      if (bar?.contains(document.activeElement)) focusLost.current();
    };
  }, []);
  return (
    <div className="undo-enter grid">
      <div className="overflow-hidden">
        <fieldset
          ref={ref}
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
