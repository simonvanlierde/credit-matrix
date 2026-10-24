"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { UNDO_WINDOW_MS } from "@/components/ui/undo-bar";
import { announce } from "@/lib/announce";

export interface Status {
  kind: "success" | "error";
  message: string;
  /** Buttons after the message, in this order (Undo first, then a way onward). Each also dismisses the strip. */
  actions?: readonly { label: string; onAct: () => void }[];
  /**
   * Runs when the strip leaves for any reason — the dismiss button, the
   * timeout, the action, or a newer status replacing it — so anything shown
   * alongside the strip (a row mark, a cell halo) can leave with it.
   */
  onDismiss?: () => void;
}

// Module-level fan-out, same pattern as announce(): any client module can show
// a status without threading context through the server layout.
// `replacing` set: take the strip down only while it still shows that status.
const listeners = new Set<(status: Status | null, replacing?: Status) => void>();

/** Show a visible outcome strip. Announces to assistive tech itself. */
export function showStatus(status: Status) {
  announce(status.message, { assertive: status.kind === "error" });
  for (const listener of listeners) listener(status);
}

/** Take this strip down, if it is still the one showing. */
export function dismissStatus(status: Status) {
  for (const listener of listeners) listener(null, status);
}

/**
 * The one visible surface for share/merge outcomes. Fixed under the header so
 * showing it never reflows the workspace; the paired announcement comes from
 * showStatus, so this strip is deliberately not a live region (it would say
 * everything twice).
 */
export function StatusBanner() {
  const t = useTranslations();
  const [status, setStatus] = useState<Status | null>(null);
  // The strip on screen, read synchronously: onDismiss runs here, never inside a state updater.
  const showing = useRef<Status | null>(null);

  const replace = useCallback((next: Status | null) => {
    const previous = showing.current;
    if (previous === next) return;
    showing.current = next;
    // A replaced strip was still dismissed: its companions leave with it.
    previous?.onDismiss?.();
    setStatus(next);
  }, []);

  useEffect(() => {
    const onStatus = (next: Status | null, replacing?: Status) => {
      if (replacing === undefined || showing.current === replacing) replace(next);
    };
    listeners.add(onStatus);
    return () => {
      listeners.delete(onStatus);
    };
  }, [replace]);

  const dismiss = () => replace(null);

  // Fixed over the content, the strip would hide whatever takes focus beneath
  // it (WCAG 2.4.11), and an error stays until dismissed. Focus landing under
  // it sends it to the other edge instead.
  const stripRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);
  useEffect(() => {
    if (!status) return;
    const onFocusIn = (event: FocusEvent) => {
      const strip = stripRef.current;
      if (!strip || !(event.target instanceof Element) || strip.contains(event.target)) return;
      const a = strip.getBoundingClientRect();
      const b = event.target.getBoundingClientRect();
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) setAtBottom((v) => !v);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [status]);

  // Successes leave on their own; errors stay until dismissed. A success
  // carrying an action (Undo) gets the same 60s the contributor-removal undo
  // gives, for the same WCAG 2.2.1 reason.
  useEffect(() => {
    if (!status || status.kind === "error") return;
    const timer = window.setTimeout(() => replace(null), status.actions?.length ? UNDO_WINDOW_MS : 10000);
    return () => window.clearTimeout(timer);
  }, [status, replace]);

  if (!status) return null;

  return (
    <div
      ref={stripRef}
      className={`pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 ${atBottom ? "bottom-4" : "top-16"}`}
    >
      <div
        className={`pointer-events-auto flex max-w-xl items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-md ${
          status.kind === "error"
            ? "border-error/40 bg-error-container/90 text-on-error-container"
            : "border-primary/30 bg-surface-bright text-on-surface"
        }`}
      >
        {status.kind === "error" ? (
          <CircleAlert className="h-4 w-4 shrink-0 text-error" aria-hidden="true" />
        ) : (
          <CircleCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        )}
        <span className="min-w-0">{status.message}</span>
        {status.actions?.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              action.onAct();
              // An action may show a status of its own ("nothing to undo"); that one stays.
              if (showing.current === status) dismiss();
            }}
            className="min-h-6 shrink-0 rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("statusDismiss")}
          className="flex size-7 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
