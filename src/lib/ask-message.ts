import type { useTranslations } from "use-intl";
import type { Author } from "@/core";
import { announce } from "@/lib/announce";
import { buildShareUrl, shareFailureKey } from "@/lib/share";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Build one contributor's ask link, hand it to `copy`, and record the ask once
 * `copy` says it reached the clipboard. A blank ask sends their row empty;
 * otherwise the link carries your guess for them to check. `copy` also gets
 * the title the link was built with. Returns whether it was copied.
 */
export async function copyAskLink(
  author: Author,
  t: ReturnType<typeof useTranslations>,
  blank: boolean,
  copy: (link: string, title: string) => Promise<boolean>,
): Promise<boolean> {
  const sentAt = Date.now();
  // Read at click time: the link carries this person's current row and the title.
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
      yesNo: state.inputMode === "toggle",
    });
  } catch {
    announce(t(shareFailureKey()), { assertive: true });
    return false;
  }
  if (!(await copy(link, state.title))) return false;
  // The draft may have switched, or the row gone, while the link was built.
  const now = useContributionStore.getState();
  if (now.activeDraftId === state.activeDraftId && now.authors.some((a) => a.id === author.id)) {
    now.applyAskStep(now.activeDraftId, { kind: "sent", contributorId: author.id, prefilled: !blank, at: sentAt });
  }
  return true;
}

/**
 * Copy an email-ready message asking one contributor, around their ask link,
 * and record the ask once it reached the clipboard. With `role`, the message
 * asks about that one role, and the link carries your guess for them to check.
 * Returns whether the message was copied.
 */
export function copyAskMessage(
  author: Author,
  t: ReturnType<typeof useTranslations>,
  { role }: { role?: string } = {},
): Promise<boolean> {
  return copyAskLink(author, t, role === undefined, async (link, rawTitle) => {
    const title = rawTitle.trim();
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
    announce(t("teamMessageCopied", { name: author.name }));
    return true;
  });
}
