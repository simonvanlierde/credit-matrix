"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { announce } from "@/lib/announce";

export interface Status {
  kind: "success" | "error";
  message: string;
  action?: { label: string; onAct: () => void };
  /**
   * Runs when the strip leaves for any reason — the dismiss button, the
   * timeout, the action, or a newer status replacing it — so anything shown
   * alongside the strip (a row mark, a cell halo) can leave with it.
   */
  onDismiss?: () => void;
}

// Module-level fan-out, same pattern as announce(): any client module can show
// a status without threading context through the server layout.
const listeners = new Set<(status: Status) => void>();

/** Show a visible outcome strip. Announces to assistive tech itself. */
export function showStatus(status: Status) {
  announce(status.message, { assertive: status.kind === "error" });
  for (const listener of listeners) listener(status);
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

  useEffect(() => {
    const onStatus = (next: Status) =>
      setStatus((previous) => {
        // A replaced strip was still dismissed: its companions leave with it.
        if (previous !== next) previous?.onDismiss?.();
        return next;
      });
    listeners.add(onStatus);
    return () => {
      listeners.delete(onStatus);
    };
  }, []);

  function dismiss() {
    status?.onDismiss?.();
    setStatus(null);
  }

  // Successes leave on their own; errors stay until dismissed. A success
  // carrying an action (Undo) gets the same 60s the contributor-removal undo
  // gives, for the same WCAG 2.2.1 reason.
  useEffect(() => {
    if (!status || status.kind === "error") return;
    const timer = window.setTimeout(
      () => {
        status.onDismiss?.();
        setStatus(null);
      },
      status.action ? 60000 : 10000,
    );
    return () => window.clearTimeout(timer);
  }, [status]);

  if (!status) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-3">
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
        {status.action && (
          <button
            type="button"
            onClick={() => {
              status.action?.onAct();
              dismiss();
            }}
            className="min-h-6 shrink-0 rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {status.action.label}
          </button>
        )}
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
