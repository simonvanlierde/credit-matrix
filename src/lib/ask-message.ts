import type { useTranslations } from "use-intl";
import type { Author } from "@/core";
import { announce } from "@/lib/announce";
import { buildShareUrl, shareFailureKey } from "@/lib/share";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Copy an email-ready message asking one contributor, around their ask link,
 * and record the ask once it reached the clipboard. With `role`, the message
 * asks about that one role, and the link carries your guess for them to check.
 * Returns whether the message was copied.
 */
export async function copyAskMessage(
  author: Author,
  t: ReturnType<typeof useTranslations>,
  { role }: { role?: string } = {},
): Promise<boolean> {
  const blank = role === undefined;
  const sentAt = Date.now();
  // Read at click time: the link carries the whole roster and the title.
  const state = useContributionStore.getState();
  let link: string;
  try {
    link = await buildShareUrl({
      authors: state.authors,
      title: state.title,
      claimId: author.id,
      sourceDraftId: state.activeDraftId,
      blank,
      sentAt,
    });
  } catch {
    announce(t(shareFailureKey()), { assertive: true });
    return false;
  }
  const title = state.title.trim();
  const work = title ? t("teamMessageWork", { title }) : t("teamMessageNoTitle");
  const text =
    role === undefined
      ? t("teamMessage", { name: author.name, work, link })
      : t("reviewAskMessage", { name: author.name, work, role, link });
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    announce(t("annCopyFailed"), { assertive: true });
    return false;
  }
  // The draft may have switched, or the row gone, while the link was built.
  const now = useContributionStore.getState();
  if (now.activeDraftId === state.activeDraftId && now.authors.some((a) => a.id === author.id)) {
    now.applyAskStep(now.activeDraftId, { kind: "sent", contributorId: author.id, prefilled: !blank, at: sentAt });
  }
  announce(t("teamMessageCopied", { name: author.name }));
  return true;
}
