"use client";

import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { useTranslations } from "use-intl";
import { NormsPanel } from "@/components/NormsPanel";
import { ReviewPanel } from "@/components/ReviewPanel";
import { StatementOutput } from "@/components/steps/StatementOutput";
import { TeamPanel } from "@/components/TeamPanel";
import { type InspectorTab, useAskSummary, useContributionStore } from "@/store/contribution-store";

const TABS: InspectorTab[] = ["statement", "team", "review", "norms"];

/**
 * The workspace's right-hand pane: the statement, the team's ask status,
 * co-author answers, and published practice as context, as one tab list (WAI-ARIA
 * tabs pattern: one tab stop, arrow keys and Home/End move between tabs, which
 * select on focus).
 *
 * Inactive panels stay mounted and hidden, so statement options survive a
 * look at the Team tab.
 */
export function Inspector() {
  const t = useTranslations();
  const tab = useContributionStore((s) => s.inspectorTab);
  const setTab = useContributionStore((s) => s.setInspectorTab);
  const listRef = useRef<HTMLDivElement>(null);
  const openCount = useAskSummary().open;
  // The APG tabs pattern makes a panel a tab stop only when nothing in it is
  // focusable; otherwise it is an extra stop before its own first control.
  // These mirror the empty states of TeamPanel and ReviewPanel.
  const teamEmpty = useContributionStore(
    (s) => s.claim !== null || !s.authors.some((author) => author.id !== s.selfId),
  );
  const reviewEmpty = useContributionStore(
    (s) => !s.authors.some((author) => author.id !== s.selfId && s.asks[author.id]?.reply),
  );
  const panelIsStop: Record<InspectorTab, boolean> = {
    statement: false,
    team: teamEmpty,
    review: reviewEmpty,
    // The table scrolls inside the panel and holds no control, so the panel takes the stop that
    // lets a keyboard scroll it.
    norms: true,
  };

  const labels: Record<InspectorTab, string> = {
    statement: t("stepStatement"),
    team: t("tabTeam"),
    review: t("tabReview"),
    norms: t("tabNorms"),
  };
  const panels: Record<InspectorTab, ReactNode> = {
    statement: <StatementOutput />,
    team: <TeamPanel />,
    review: <ReviewPanel />,
    norms: <NormsPanel />,
  };

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = TABS.indexOf(tab);
    const target =
      event.key === "ArrowRight"
        ? (current + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (current + TABS.length - 1) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : -1;
    const next = TABS[target];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    const button = listRef.current?.querySelector<HTMLButtonElement>(`#inspector-tab-${next}`);
    button?.focus();
    // Focus alone does not scroll a tab list that overflows on a narrow screen.
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return (
    <div className="flex flex-col desk:h-full desk:min-h-0">
      <div
        ref={listRef}
        role="tablist"
        aria-label={t("a11yInspector")}
        onKeyDown={handleKeyDown}
        className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-outline-variant/40 px-3 pt-2 md:px-4"
      >
        {TABS.map((id) => {
          const selected = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`inspector-tab-${id}`}
              aria-selected={selected}
              aria-controls={`inspector-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(id)}
              className={`min-h-10 border-b-2 px-2 text-[13px] leading-tight sm:px-3 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                selected
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {labels[id]}
              {id === "review" && openCount > 0 && (
                <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-on-primary">
                  <span aria-hidden="true">{openCount}</span>
                  <span className="sr-only">{t("tabReviewOpen", { count: openCount })}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {TABS.map((id) => (
        <div
          key={id}
          role="tabpanel"
          id={`inspector-panel-${id}`}
          aria-labelledby={`inspector-tab-${id}`}
          hidden={id !== tab}
          tabIndex={panelIsStop[id] ? 0 : undefined}
          className="p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:p-4 desk:min-h-0 desk:flex-1 desk:overflow-y-auto"
        >
          {panels[id]}
        </div>
      ))}
    </div>
  );
}
