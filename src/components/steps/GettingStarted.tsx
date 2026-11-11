import { Check, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslations } from "@/lib/translations";
import { useContributionStore } from "@/store/contribution-store";
import { useGuide } from "@/store/guide-store";

/** The steps from names to a statement in the manuscript, each ticked by what the draft shows. */
const STEPS = ["roles", "ask", "copy"] as const;
export type GuideStep = (typeof STEPS)[number];

/**
 * A short checklist at the head of the status strip. It ticks itself from the
 * draft, never from a Next button, and names the next step. The Ask and Copy
 * controls carry `data-guide-target` and get a ring while they are next (see
 * `[data-guide]` in globals.css), so the help sits on the control itself, not
 * in a tour over the page; ticking roles has the empty grid as its cue. Adding
 * people is the empty grid's own job, so the list starts once someone is on it.
 * Hidden for good once every step is done or the list is closed.
 */
export function GettingStarted({ asked }: { asked: number }) {
  const t = useTranslations();
  const hasRoles = useContributionStore((s) => s.authors.some((a) => a.contributions.some((c) => c.score > 0)));
  // Asking needs someone to ask; a draft of one skips the step.
  const solo = useContributionStore((s) => s.authors.length < 2);
  const { copied, dismissed, dismiss } = useGuide();
  useEffect(() => {
    // With site data blocked, zustand attaches no persist API at all: the list then lives for the visit.
    void useGuide.persist?.rehydrate();
  }, []);

  const done: Record<GuideStep, boolean> = { roles: hasRoles, ask: asked > 0 || solo, copy: copied };
  const next = STEPS.find((step) => !done[step]);
  const visible = !dismissed && next !== undefined;

  useEffect(() => {
    if (!visible) return;
    document.documentElement.dataset.guide = next;
    return () => {
      delete document.documentElement.dataset.guide;
    };
  }, [visible, next]);

  if (!visible) return null;
  const labels: Record<GuideStep, string> = {
    roles: t("guideStepRoles"),
    ask: t("guideStepAsk"),
    copy: t("guideStepCopy"),
  };
  return (
    <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
      <span className="font-semibold text-on-surface">{t("guideTitle")}</span>
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {STEPS.map((step) => (
          <li
            key={step}
            aria-current={step === next ? "step" : undefined}
            className={`flex items-center gap-1 ${step === next ? "font-semibold text-accent" : ""}`}
          >
            {done[step] ? (
              <Check aria-hidden="true" className="size-3.5 text-on-surface-variant" />
            ) : (
              <span
                aria-hidden="true"
                className={`size-2 rounded-full border ${step === next ? "border-accent bg-accent" : "border-outline-strong"}`}
              />
            )}
            <span className={done[step] ? "line-through decoration-outline-strong" : ""}>{labels[step]}</span>
            {done[step] && <span className="sr-only">{t("guideDone")}</span>}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("guideDismiss")}
        title={t("guideDismiss")}
        className="hit-area inline-flex size-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
