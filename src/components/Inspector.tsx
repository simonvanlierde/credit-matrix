"use client";

import { MessagesSquare } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { useTranslations } from "use-intl";
import { StatementOutput } from "@/components/steps/StatementOutput";
import { TeamPanel } from "@/components/TeamPanel";
import { type InspectorTab, useContributionStore } from "@/store/contribution-store";

const TABS: InspectorTab[] = ["statement", "team", "review"];

/**
 * The workspace's right-hand pane: the statement, the team's ask status, and
 * co-author answers, as one tab list (WAI-ARIA tabs pattern: one tab stop,
 * arrow keys and Home/End move between tabs, which select on focus).
 *
 * Inactive panels stay mounted and hidden, so statement options survive a
 * look at the Team tab.
 */
export function Inspector() {
  const t = useTranslations();
  const tab = useContributionStore((s) => s.inspectorTab);
  const setTab = useContributionStore((s) => s.setInspectorTab);
  const listRef = useRef<HTMLDivElement>(null);

  const labels: Record<InspectorTab, string> = {
    statement: t("stepStatement"),
    team: t("tabTeam"),
    review: t("tabReview"),
  };
  const panels: Record<InspectorTab, ReactNode> = {
    statement: <StatementOutput />,
    team: <TeamPanel />,
    review: <ReviewPlaceholder />,
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
    listRef.current?.querySelector<HTMLButtonElement>(`#inspector-tab-${next}`)?.focus();
  }

  return (
    <div className="flex flex-col desk:h-full desk:min-h-0">
      <div
        ref={listRef}
        role="tablist"
        aria-label={t("a11yInspector")}
        onKeyDown={handleKeyDown}
        className="flex shrink-0 gap-1 border-b border-outline-variant/40 px-3 pt-2 md:px-4"
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
              className={`-mb-px min-h-10 border-b-2 px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                selected
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {labels[id]}
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
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the APG tabs pattern makes a panel focusable, and the panel scrolls on its own.
          tabIndex={0}
          className="p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:p-4 desk:min-h-0 desk:flex-1 desk:overflow-y-auto"
        >
          {panels[id]}
        </div>
      ))}
    </div>
  );
}

/** Where co-author answers will be compared with the draft. */
function ReviewPlaceholder() {
  const t = useTranslations();
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg bg-surface-container-low px-4 py-8 text-center">
      <MessagesSquare className="size-6 text-on-surface-variant" aria-hidden="true" />
      <p className="font-headline text-lg italic text-primary">{t("reviewEmptyTitle")}</p>
      <p className="max-w-[40ch] text-sm text-on-surface-variant">{t("reviewEmptyBody")}</p>
    </div>
  );
}
