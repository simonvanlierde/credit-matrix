"use client";

import { Check, Copy, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { daysSince, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ask-panel-shared";
import { InitialsChip } from "@/components/ui/initials-chip";
import { type Author, review, settledAt } from "@/core";
import { announce } from "@/lib/announce";
import { copyAskMessage } from "@/lib/ask-message";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Who has been asked, and the message that asks them. Each message is an
 * email-ready text around the same ask link the row menu copies, sent blank so
 * the answer is the co-author's own account rather than a check of a guess.
 */
export function TeamPanel() {
  const t = useTranslations();
  const authors = useContributionStore((s) => s.authors);
  const asks = useContributionStore((s) => s.asks);
  const activeDraftId = useContributionStore((s) => s.activeDraftId);
  const selfId = useContributionStore((s) => s.selfId);
  const openReview = useContributionStore((s) => s.openReview);
  const format = useFormatter();
  const { locked } = useClaimLock();
  // The last message copied, for the visible confirmation and the row's check.
  const [copied, setCopied] = useState<{ id: string; name: string } | null>(null);
  // "Ask everyone": the people still to copy, in roster order. The clipboard
  // holds one text at a time, so the sequence advances one click per person.
  const [queue, setQueue] = useState<{ ids: string[]; done: number } | null>(null);
  const [finished, setFinished] = useState<number | null>(null);

  // Progress belongs to the draft it started on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs on draft switch by design
  useEffect(() => {
    setQueue(null);
    setCopied(null);
    setFinished(null);
  }, [activeDraftId]);

  if (locked) {
    return <p className="text-sm text-on-surface-variant">{t("claimLockedHint")}</p>;
  }
  // You are not your own co-author.
  const team = authors.filter((author) => author.id !== selfId);
  if (team.length === 0) {
    return <p className="text-sm text-on-surface-variant">{t("teamEmpty")}</p>;
  }

  const notAsked = team.filter((author) => !(author.id in asks));

  function statusOf(author: Author): { text: string; toReview: boolean } {
    const ask = asks[author.id];
    if (!ask) return { text: t("teamNotAsked"), toReview: false };
    const { status } = review(author, ask);
    if (status.kind === "differs" && ask.reply) {
      return {
        text: t("teamStatusAnswered", { days: daysSince(ask.reply.receivedAt), count: status.count }),
        toReview: true,
      };
    }
    if (status.kind === "settled" && ask.reply) {
      const date = format.dateTime(settledAt(ask.reply), { day: "numeric", month: "short" });
      return { text: t("teamSettledOn", { date }), toReview: false };
    }
    return {
      text: t("teamStatusAsked", { days: daysSince(ask.sentAt), kind: ask.prefilled ? "prefilled" : "blank" }),
      toReview: false,
    };
  }

  /** Copy one person's message and record the ask. Returns whether it reached the clipboard. */
  async function copyMessage(author: Author): Promise<boolean> {
    if (!(await copyAskMessage(author, t))) return false;
    setCopied({ id: author.id, name: author.name });
    setFinished(null);
    return true;
  }

  async function askNext() {
    const ids = queue?.ids ?? notAsked.map((author) => author.id);
    const done = queue?.done ?? 0;
    const next = team.find((candidate) => candidate.id === ids[done]);
    if (!next) {
      setQueue(null);
      return;
    }
    if (!(await copyMessage(next))) return;
    if (done + 1 >= ids.length) {
      setQueue(null);
      setFinished(ids.length);
      announce(t("teamAskAllDone", { count: ids.length }));
    } else {
      setQueue({ ids, done: done + 1 });
    }
  }

  const nextName = queue ? team.find((author) => author.id === queue.ids[queue.done])?.name : undefined;

  return (
    <div className="flex flex-col gap-3">
      {(notAsked.length > 0 || queue) && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void askNext()} className={`${PRIMARY_BUTTON} min-h-9 text-sm`}>
              <Send className="size-4" aria-hidden="true" />
              {queue && nextName
                ? t("teamAskNext", { name: nextName, index: queue.done + 1, total: queue.ids.length })
                : t("teamAskAll", { count: notAsked.length })}
            </button>
            {queue && (
              <button type="button" onClick={() => setQueue(null)} className={SECONDARY_BUTTON}>
                {t("cancel")}
              </button>
            )}
          </div>
          <p className="text-xs text-on-surface-variant">{t("teamAskAllHint")}</p>
        </div>
      )}

      {/* The outcome of the last copy, in words, next to the controls that made it. */}
      {(copied || finished !== null) && (
        <p className="flex items-start gap-1.5 rounded-md bg-primary/5 px-3 py-2 text-xs text-on-surface">
          <Check className="mt-px size-3.5 shrink-0 text-primary" aria-hidden="true" />
          {finished !== null
            ? t("teamAskAllDone", { count: finished })
            : t("teamMessageCopied", { name: copied?.name ?? "" })}
        </p>
      )}

      <p className="text-xs leading-relaxed text-on-surface-variant">{t("teamPrivacy")}</p>

      <ul className="flex flex-col divide-y divide-outline-variant/40 border-t border-outline-variant/40">
        {team.map((author) => {
          const ask = asks[author.id];
          const status = statusOf(author);
          const justCopied = copied?.id === author.id;
          return (
            <li key={author.id} className="flex items-center gap-2.5 py-2">
              <InitialsChip author={author} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-on-surface" title={author.name}>
                  {author.name}
                </span>
                <span className={`text-xs ${status.toReview ? "font-medium text-primary" : "text-on-surface-variant"}`}>
                  {status.text}
                </span>
              </span>
              {status.toReview ? (
                <button
                  type="button"
                  onClick={() => openReview(author.id)}
                  aria-label={t("teamReviewFor", { name: author.name })}
                  className={PRIMARY_BUTTON}
                >
                  {t("reviewAction")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void copyMessage(author)}
                  aria-label={t("teamCopyMessageFor", { name: author.name })}
                  className={ask ? SECONDARY_BUTTON : PRIMARY_BUTTON}
                >
                  {justCopied ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                  {justCopied ? t("copied") : t("teamCopyMessage")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
