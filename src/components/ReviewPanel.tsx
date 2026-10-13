"use client";

import { ArrowRight, Check, MessagesSquare } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { LevelMark } from "@/components/ui/level-mark";
import {
  ASK_TARGETS,
  type Ask,
  type Author,
  type Choice,
  CREDIT_ROLES,
  type Difference,
  heatCellColor,
  isMarker,
  LEVEL_SCORE,
  type Level,
  levelOf,
  onColor,
  type Reply,
  review,
  settledAt,
  type Target,
} from "@/core";
import { announce } from "@/lib/announce";
import { copyAskMessage } from "@/lib/ask-message";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useContributionStore } from "@/store/contribution-store";

const DAY_MS = 24 * 60 * 60 * 1000;

const PRIMARY_BUTTON =
  "inline-flex min-h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-on-primary transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";
const SECONDARY_BUTTON =
  "inline-flex min-h-8 items-center rounded-lg border border-outline px-3 text-xs font-medium text-on-surface transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const LINK_BUTTON =
  "inline-flex min-h-8 items-center rounded px-1 text-xs font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** The desktop layout, where the grid sits beside this list and can scroll on its own. */
const SIDE_BY_SIDE = "(min-width: 80rem) and (min-height: 45rem)";

type Line =
  | { target: Target; state: "open" | "kept"; difference: Difference }
  | { target: Target; state: "used"; level: Level };

/** Every difference in one answer, open or decided, in `ASK_TARGETS` order. */
function linesOf(author: Author, ask: Ask, reply: Reply): Line[] {
  const { byTarget, open } = review(author, ask);
  const lines: Line[] = [];
  for (const target of ASK_TARGETS) {
    const difference = byTarget[target];
    const decision = reply.decisions[target];
    if (difference && open.includes(difference)) lines.push({ target, state: "open", difference });
    else if (difference && decision?.choice === "mine") lines.push({ target, state: "kept", difference });
    else if (!difference && decision?.choice === "theirs") {
      lines.push({ target, state: "used", level: levelOf(author, target) });
    }
  }
  return lines;
}

/** The grid cell a role's line points at, by the data attribute GridCell sets. */
function gridCell(contributorId: string, target: Target): HTMLElement | null {
  const roleIndex = CREDIT_ROLES.findIndex((role) => role.name === target);
  if (roleIndex === -1) return null;
  return document.querySelector(`[data-cell-key="${contributorId}:${roleIndex}"]`);
}

/**
 * Where co-author answers meet the draft: every difference, grouped per person,
 * each settled with their answer or yours. Choosing keeps focus in the list and
 * moves it to the next open line, and every choice is announced.
 */
export function ReviewPanel() {
  const t = useTranslations();
  const format = useFormatter();
  const authors = useContributionStore((s) => s.authors);
  const asks = useContributionStore((s) => s.asks);
  const selfId = useContributionStore((s) => s.selfId);
  const reviewFocus = useContributionStore((s) => s.reviewFocus);
  const tab = useContributionStore((s) => s.inspectorTab);
  const monoColor = useContributionStore((s) => s.heatmapMonoColor);
  const levels = useContributionStore((s) => s.inputMode === "levels");
  const dark = useTheme().resolvedTheme === "dark";
  const { translateInterfaceRole, translateInterfaceUi } = useCreditTranslators();
  const listRef = useRef<HTMLDivElement>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Where focus goes once the list has re-rendered after a choice: past the line, or back onto it.
  const pendingFocus = useRef<{ key: string; stay: boolean } | null>(null);

  const people = authors.flatMap((author) => {
    const ask = asks[author.id];
    if (author.id === selfId || !ask?.reply) return [];
    return [{ author, ask, reply: ask.reply, result: review(author, ask), lines: linesOf(author, ask, ask.reply) }];
  });
  const openTotal = people.reduce((sum, person) => sum + person.result.open.length, 0);

  useEffect(() => {
    const pending = pendingFocus.current;
    const list = listRef.current;
    if (!(pending && list)) return;
    pendingFocus.current = null;
    const lines = [...list.querySelectorAll<HTMLElement>("[data-review-line]")];
    const index = lines.findIndex((line) => line.dataset.reviewLine === pending.key);
    const open = (line: HTMLElement) => line.dataset.open === "true";
    const target = pending.stay
      ? lines[index]
      : (lines.slice(index + 1).find(open) ?? lines.slice(0, Math.max(index, 0)).find(open));
    const button = target?.querySelector<HTMLElement>("[data-review-first]");
    (button ?? list.querySelector<HTMLElement>("[data-review-done]") ?? list).focus();
  });

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // A column badge or the Team tab asked for one person's answers.
  useEffect(() => {
    if (!reviewFocus || tab !== "review") return;
    const heading = document.getElementById(`review-person-${reviewFocus}`);
    heading?.scrollIntoView({ block: "start" });
    heading?.focus();
    useContributionStore.setState({ reviewFocus: null });
  }, [reviewFocus, tab]);

  if (people.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg bg-surface-container-low px-4 py-8 text-center">
        <MessagesSquare className="size-6 text-on-surface-variant" aria-hidden="true" />
        <p className="font-headline text-lg italic text-primary">{t("reviewEmptyTitle")}</p>
        <p className="max-w-[40ch] text-sm text-on-surface-variant">{t("reviewEmptyBody")}</p>
      </div>
    );
  }

  const firstName = (author: Author) => author.firstName || author.name;
  const targetName = (target: Target) =>
    target === "equalContribution"
      ? t("markerSharedFirst")
      : target === "corresponding"
        ? t("markerCorresponding")
        : translateInterfaceRole(target);
  // In yes/no mode a level is only worth naming when both sides contributed.
  const levelName = (level: Level, graded: boolean) =>
    typeof level === "boolean"
      ? level
        ? t("markerYes")
        : t("markerNo")
      : translateInterfaceUi(graded || level === "none" ? level : "contributed");

  function highlight(author: Author, target: Target | null) {
    const store = useContributionStore.getState();
    if (!target) {
      store.setReviewHighlight(null);
      return;
    }
    store.setReviewHighlight({ contributorId: author.id, target });
    if (!window.matchMedia(SIDE_BY_SIDE).matches) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gridCell(author.id, target)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  }

  function choose(author: Author, targets: Target[], choice: Choice, key: string) {
    const store = useContributionStore.getState();
    const { outcome } = store.applyAskStep(store.activeDraftId, {
      kind: "settle",
      contributorId: author.id,
      choices: Object.fromEntries(targets.map((target) => [target, choice])),
      at: Date.now(),
    });
    if (outcome.kind !== "settled") return;
    if (choice === "theirs") {
      store.setReviewSettled({ contributorId: author.id, targets });
      window.setTimeout(() => {
        if (useContributionStore.getState().reviewSettled?.targets === targets) store.setReviewSettled(null);
      }, 1000);
    }
    const name = firstName(author);
    const role = targetName(targets[0] as Target);
    announce(
      targets.length > 1
        ? t("annReviewUsedAll", { name })
        : choice === "theirs"
          ? t("annReviewUsed", { name, role })
          : t("annReviewKept", { role }),
    );
    pendingFocus.current = { key, stay: false };
  }

  /** Clear one line's decision; a "theirs" also puts the row's own value back. */
  function undo(author: Author, target: Target, key: string) {
    const store = useContributionStore.getState();
    const { outcome } = store.applyAskStep(store.activeDraftId, {
      kind: "settle",
      contributorId: author.id,
      choices: { [target]: null },
    });
    if (outcome.kind !== "settled") return;
    announce(t("annReviewUndone"));
    pendingFocus.current = { key, stay: true };
  }

  async function askAbout(author: Author, target: Target, key: string) {
    if (!(await copyAskMessage(author, t, { role: targetName(target) }))) return;
    setCopiedKey(key);
    // Same 2s window as useCopyStatus, so "Copied" never outlives the copy.
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div ref={listRef} className="flex flex-col gap-6">
      {openTotal === 0 && (
        <div className="rounded-lg bg-surface-container-low px-4 py-5 text-center">
          <p
            data-review-done=""
            tabIndex={-1}
            className="font-headline text-xl italic text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("reviewAllSettledTitle")}
          </p>
          <p className="mx-auto mt-1 max-w-[40ch] text-sm text-on-surface-variant">{t("reviewAllSettledBody")}</p>
        </div>
      )}

      {people.map(({ author, ask, reply, result, lines }) => {
        const name = firstName(author);
        const days = Math.max(0, Math.floor((Date.now() - reply.receivedAt) / DAY_MS));
        const meta =
          result.status.kind === "settled"
            ? t("teamSettledOn", { date: format.dateTime(settledAt(reply), { day: "numeric", month: "short" }) })
            : t("reviewAnsweredMeta", { days, kind: ask.prefilled ? "prefilled" : "blank" });
        const headingId = `review-person-${author.id}`;
        return (
          <section key={author.id} aria-labelledby={headingId} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3
                  id={headingId}
                  tabIndex={-1}
                  className="scroll-mt-4 font-headline text-lg leading-snug font-semibold text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {author.name}
                </h3>
                <p className="text-xs text-on-surface-variant">{meta}</p>
              </div>
              {result.open.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    choose(
                      author,
                      result.open.map((difference) => difference.target),
                      "theirs",
                      `${author.id}:${result.open[0]?.target}`,
                    )
                  }
                  className={`${LINK_BUTTON} shrink-0`}
                >
                  {t("reviewUseAll", { name })}
                </button>
              )}
            </div>

            {lines.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{t("askReplyMatches", { name })}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lines.map((line) => {
                  const key = `${author.id}:${line.target}`;
                  const role = targetName(line.target);
                  const marker = isMarker(line.target);
                  const kind =
                    line.state === "used"
                      ? null
                      : line.difference.kind === "level"
                        ? t("reviewKindLevel")
                        : line.difference.kind === "dropped"
                          ? t("reviewKindDropped")
                          : marker
                            ? t("reviewKindMarked")
                            : t("reviewKindAdded");
                  const isOpen = line.state === "open";
                  const graded = levels || (line.state !== "used" && line.difference.kind === "level");
                  // Focus rings the cell as hovering does; the buttons carry it, since the line is not focusable.
                  const focusRing = {
                    onFocus: () => highlight(author, line.target),
                    onBlur: () => highlight(author, null),
                  };
                  return (
                    <li
                      key={line.target}
                      data-review-line={key}
                      data-open={isOpen}
                      onPointerEnter={() => highlight(author, line.target)}
                      onPointerLeave={() => highlight(author, null)}
                      className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors hover:border-flag focus-within:border-flag ${
                        isOpen ? "border-outline bg-surface-bright" : "border-outline-variant bg-surface-container-low"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-on-surface">{role}</span>
                        {kind && <span className="shrink-0 text-[11px] text-on-surface-variant">{kind}</span>}
                      </div>

                      {line.state === "used" ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-on-surface">
                          <LevelChip level={line.level} graded={levels} monoColor={monoColor} dark={dark} />
                          {levelName(line.level, levels)}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-on-surface">
                          <span className="text-on-surface-variant">{t("teamYou")}</span>
                          <LevelChip level={line.difference.mine} graded={graded} monoColor={monoColor} dark={dark} />
                          {levelName(line.difference.mine, graded)}
                          <ArrowRight className="size-3.5 text-on-surface-variant" aria-hidden="true" />
                          <span className="text-on-surface-variant">{name}</span>
                          <LevelChip level={line.difference.theirs} graded={graded} monoColor={monoColor} dark={dark} />
                          {levelName(line.difference.theirs, graded)}
                        </div>
                      )}

                      {isOpen ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            data-review-first=""
                            onClick={() => choose(author, [line.target], "theirs", key)}
                            aria-label={`${t("reviewUseTheirs", { name })}: ${role}`}
                            className={PRIMARY_BUTTON}
                            {...focusRing}
                          >
                            {t("reviewUseTheirs", { name })}
                          </button>
                          <button
                            type="button"
                            onClick={() => choose(author, [line.target], "mine", key)}
                            aria-label={`${t("reviewKeepYours")}: ${role}`}
                            className={SECONDARY_BUTTON}
                            {...focusRing}
                          >
                            {t("reviewKeepYours")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void askAbout(author, line.target, key)}
                            aria-label={t("reviewAskAboutRole", { name, role, copied: String(copiedKey === key) })}
                            className={LINK_BUTTON}
                            {...focusRing}
                          >
                            {copiedKey === key ? t("copied") : t("reviewAskAbout", { name })}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-on-surface">
                          <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                          <span className="flex-1">
                            {line.state === "used" ? t("reviewUsedTheirs", { name }) : t("reviewKeptYours")}
                          </span>
                          <button
                            type="button"
                            data-review-first=""
                            onClick={() => undo(author, line.target, key)}
                            aria-label={`${t("undo")}: ${role}`}
                            className={LINK_BUTTON}
                            {...focusRing}
                          >
                            {t("undo")}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A level as the grid draws it: the heatmap fill and its dots, or a check for a marker. */
function LevelChip({
  level,
  graded,
  monoColor,
  dark,
}: {
  level: Level;
  graded: boolean;
  monoColor: string;
  dark: boolean;
}) {
  const score = typeof level === "boolean" ? (level ? 100 : 0) : LEVEL_SCORE[level];
  const fill = score > 0 ? heatCellColor(monoColor, graded ? score : 100, dark) : null;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-4 w-7 shrink-0 items-center justify-center rounded-sm ${fill ? "" : "ring-1 ring-inset ring-outline"}`}
      style={{ backgroundColor: fill ?? "var(--color-surface-container-high)" }}
    >
      {fill && (
        <LevelMark score={score} graded={graded && typeof level !== "boolean"} color={onColor(fill)} size="small" />
      )}
    </span>
  );
}
