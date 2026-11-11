import { useEffect, useRef, useState } from "react";
import { announce } from "@/lib/announce";
import { useTranslations } from "@/lib/translations";

type CopyStatus = "idle" | "copied" | "error";

/**
 * Copy to the clipboard, exposing a status that resets to "idle" after 2s.
 * The outcome is also announced to assistive tech; pass `labels.copied` to
 * tailor the spoken text to what was copied (defaults to a generic "Copied to
 * clipboard"). Failure always announces `annCopyFailed`, which names the manual
 * fallback — the visible button label stays short, the announcement does not.
 *
 * The returned `copy` takes either a string (written as text) or a function
 * doing the write itself. The heatmap copies an image blob, which is the same
 * status/announce/reset contract with a different clipboard call.
 */
export function useCopyStatus(labels?: {
  copied?: string;
}): [CopyStatus, (source: string | (() => Promise<void>)) => Promise<boolean>] {
  const t = useTranslations();
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Clear any pending reset on unmount so it can't setState on a dead component.
  useEffect(() => () => clearTimeout(timer.current), []);

  /** Returns whether the write landed, for callers with a success side effect. */
  async function copy(source: string | (() => Promise<void>)): Promise<boolean> {
    let copied = false;
    try {
      if (typeof source === "string") {
        await navigator.clipboard.writeText(source);
      } else {
        await source();
      }
      copied = true;
      setStatus("copied");
      announce(labels?.copied ?? t("annCopiedToClipboard"));
    } catch {
      setStatus("error");
      announce(t("annCopyFailed"), { assertive: true });
    }
    // Reset the window on each copy so rapid successive copies don't clear early.
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2000);
    return copied;
  }

  return [status, copy];
}
