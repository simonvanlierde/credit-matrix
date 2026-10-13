"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { showStatus } from "@/components/StatusBanner";
import { ensureHydrated, followOtherTab, useContributionStore } from "@/store/contribution-store";

/**
 * The workspace's link to storage: restores the saved drafts, follows other
 * tabs' saves, and says when saving stopped.
 *
 * The notice stays for as long as changes here are not saved. It sits
 * in page flow under the header, so it pushes the workspace down instead of
 * covering its controls. The alert region is always mounted, so screen
 * readers announce the message when it appears or changes.
 */
export function PersistenceStatus() {
  const t = useTranslations();
  const saveFailure = useContributionStore((s) => s.saveFailure);

  // The store skips hydration at creation to avoid an SSR mismatch, so the
  // restore runs here, on the client.
  useEffect(() => {
    void ensureHydrated();
  }, []);

  // Another tab saving the draft open here: follow it, rather than let the
  // next save here silently discard its edits. Re-registered with `t` so the
  // message speaks the current interface language.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // Visible too: the content changing under a sighted user with no
      // note would read as a glitch.
      if (followOtherTab(event)) showStatus({ kind: "success", message: t("draftUpdatedElsewhere") });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [t]);

  // A newer build saved in another tab and this one could not reload into it:
  // its edits are no longer saved either. Named first, since reloading fixes it.
  const newerVersionBlocked = useContributionStore((s) => s.newerVersionBlocked);
  const message = newerVersionBlocked
    ? t("errNewerVersionSaved")
    : saveFailure && t(saveFailure === "blocked" ? "errStorageBlocked" : "errStorageFull");

  return (
    <div role="alert">
      {message && (
        <p className="flex items-start gap-2 border-b border-error/40 bg-error-container px-3 py-2 text-sm text-on-error-container sm:px-8">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden="true" />
          {message}
        </p>
      )}
    </div>
  );
}
