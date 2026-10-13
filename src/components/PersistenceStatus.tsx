"use client";

import { CircleAlert } from "lucide-react";
import { useTranslations } from "use-intl";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Says that saving stopped, for as long as it stays stopped. In page flow
 * under the header, so it pushes the workspace down instead of covering its
 * controls. The alert region is always mounted, so screen readers announce
 * the message when it appears or changes.
 */
export function PersistenceStatus() {
  const t = useTranslations();
  const saveFailure = useContributionStore((s) => s.saveFailure);
  return (
    <div role="alert">
      {saveFailure && (
        <p className="flex items-start gap-2 border-b border-error/40 bg-error-container px-3 py-2 text-sm text-on-error-container sm:px-8">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden="true" />
          {t(saveFailure === "blocked" ? "errStorageBlocked" : "errStorageFull")}
        </p>
      )}
    </div>
  );
}
