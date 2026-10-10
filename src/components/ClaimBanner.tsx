"use client";

import { LockOpen, Send } from "lucide-react";
import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { announce } from "@/lib/announce";
import { buildShareUrl, shareFailureKey } from "@/lib/share";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Shown while the open draft answers a request addressed to one contributor.
 *
 * It answers three questions before anything is clicked: whose row this is,
 * why the rest is locked, and how the answer gets home. The lock itself lives
 * in the store; this banner is its explanation and its exit.
 */
export function ClaimBanner() {
  const t = useTranslations();
  const claim = useContributionStore((s) => s.claim);
  const authors = useContributionStore((s) => s.authors);
  const title = useContributionStore((s) => s.title);
  const activeDraftId = useContributionStore((s) => s.activeDraftId);
  const clearClaimFor = useContributionStore((s) => s.clearClaimFor);
  const [copyStatus, copy] = useCopyStatus({
    copied: t("annLinkCopied"),
  });

  const claimed = claim ? authors.find((author) => author.id === claim.contributorId) : undefined;

  // role="status" content present at first render is not announced — live
  // regions speak changes. Say the one fact that matters explicitly.
  const claimedName = claimed?.name;
  useEffect(() => {
    if (claimedName) announce(t("claimBannerTitle", { name: claimedName }));
  }, [claimedName, t]);

  if (!claim || !claimed) return null;

  async function handleSendBack() {
    if (!claim) return;
    try {
      await copy(
        await buildShareUrl({
          authors,
          title,
          claimId: claim.contributorId,
          sourceDraftId: claim.sourceDraftId,
          reply: true,
          sentAt: Date.now(),
        }),
      );
    } catch {
      announce(t(shareFailureKey()), { assertive: true });
    }
  }

  function handleUnlock() {
    clearClaimFor(activeDraftId);
    announce(t("annClaimUnlocked"));
  }

  return (
    <div role="status" className="mx-3 mt-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 md:mx-4 md:mt-4">
      <p className="text-sm font-semibold text-on-surface">{t("claimBannerTitle", { name: claimed.name })}</p>
      <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
        {claim.blank ? t("claimBannerBlank") : t("claimBannerPrefilled")} {t("claimBannerBody", { name: claimed.name })}{" "}
        {t("claimBannerHow")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => void handleSendBack()}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container"
        >
          <Send className="h-4 w-4" />
          {copyStatus === "copied" ? t("claimSendBackCopied") : t("claimSendBack")}
        </button>
        {/* The lock's exit: a claimee who wants to adopt the draft — or just
            use the app — is never stuck. Quiet while sending back is the main
            act, promoted to a real button once the reply is copied and keeping
            the draft is the natural next step. */}
        <button
          type="button"
          onClick={handleUnlock}
          className={
            copyStatus === "copied"
              ? "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/30 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              : "inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:text-primary"
          }
        >
          <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />
          {t("claimUnlock")}
        </button>
      </div>
    </div>
  );
}
