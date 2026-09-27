"use client";

import { ExternalLink, Files, Fingerprint, Send, Sparkles, TableProperties, TextQuote, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { AboutPopover } from "@/components/AboutPopover";
import { StepNumber } from "@/components/ui/step-number";
import { useContributionStore } from "@/store/contribution-store";

const STEPS = [
  {
    n: 1,
    icon: Fingerprint,
    titleKey: "welcomeStepContributors" as const,
    bodyKey: "welcomeBodyContributors" as const,
  },
  {
    n: 2,
    icon: TableProperties,
    titleKey: "welcomeStepRoles" as const,
    bodyKey: "welcomeBodyRoles" as const,
  },
  {
    n: 3,
    icon: TextQuote,
    titleKey: "welcomeStepExport" as const,
    bodyKey: "welcomeBodyExport" as const,
  },
];

/**
 * First-run welcome: a native modal over the workspace. Auto-opens once for a
 * new visitor (tracked by the persisted `welcomeSeen` flag) and is re-openable
 * from the header via the ephemeral `welcomeOpen` flag. When it is re-opened
 * over an already-populated workspace it drops the "Load sample data" action,
 * so a re-open can never overwrite real contributor data.
 *
 * It overlays rather than sits inline: as a band above the workspace it cost
 * ~295px of vertical space and reflowed the entire page on dismissal. `<dialog
 * showModal()>` gives the focus trap, Escape handling, backdrop, and inert
 * background for free, from the same primitive ImportModal uses.
 */
export function WelcomeCard({ version }: { version: string }) {
  const welcomeOpen = useContributionStore((s) => s.welcomeOpen);
  const closeWelcome = useContributionStore((s) => s.closeWelcome);
  const loadSample = useContributionStore((s) => s.loadSample);
  const hasAuthors = useContributionStore((s) => s.authors.length > 0);
  const t = useTranslations();

  // The store uses skipHydration (see contribution-store.ts), so the persisted
  // flags aren't known until HeaderActions triggers rehydration. Gate on that,
  // then auto-open exactly once for a first-time visitor.
  const [hydrated, setHydrated] = useState(false);
  // State, not a ref: the About panel portals into the dialog rather than
  // <body>, because showModal() puts this element in the top layer and makes
  // the rest of the document inert, so a panel outside it would render but
  // never take a click. The portal target has to reach render, so the element
  // has to be state.
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const onHydrated = () => {
      setHydrated(true);
      const state = useContributionStore.getState();
      // A claim or merge banner is the onboarding for a link arrival, so the
      // welcome must not land on top of it. The hash is still here at
      // hydration (the router strips it later), and `welcomeSeen` stays false
      // so a later plain visit still gets greeted.
      const arrivedOnShareLink = window.location.hash.startsWith("#s=");
      if (!state.welcomeSeen && !arrivedOnShareLink) state.openWelcome();
    };
    if (useContributionStore.persist.hasHydrated()) onHydrated();
    return useContributionStore.persist.onFinishHydration(onHydrated);
  }, []);

  // Drive the native dialog from the store flag, so the header's "How it works"
  // and the first-run auto-open share one code path.
  useEffect(() => {
    if (!dialogEl) return;
    if (welcomeOpen && !dialogEl.open) dialogEl.showModal();
    else if (!welcomeOpen && dialogEl.open) dialogEl.close();
  }, [welcomeOpen, dialogEl]);

  if (!hydrated) return null;

  return (
    <dialog
      ref={setDialogEl}
      id="getting-started"
      aria-labelledby="getting-started-title"
      onClose={closeWelcome}
      onMouseDown={(event) => {
        if (event.target === dialogEl) dialogEl?.close();
      }}
      className="m-auto w-full max-w-3xl max-h-[90dvh] overflow-y-auto rounded-lg bg-surface-bright p-0 text-on-surface shadow-2xl ring-1 ring-outline-variant/20 backdrop:bg-on-surface/30 backdrop:backdrop-blur-sm"
    >
      {/* The entrance moved onto the <dialog> itself (globals.css), so this card
          and the import modal now arrive the same way, backdrop included. */}
      <div className="relative flex flex-col gap-6 px-6 py-6 md:px-8 md:py-8">
        <button
          type="button"
          onClick={closeWelcome}
          aria-label={t("a11yDismissWelcome")}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="max-w-2xl pr-10">
          <h2
            id="getting-started-title"
            className="font-headline text-2xl italic font-semibold text-primary md:text-3xl"
          >
            {t("welcomeIntro")}
          </h2>
        </div>

        <ol className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
          {STEPS.map(({ n, icon: Icon, titleKey, bodyKey }) => (
            <li key={n} className="flex gap-3">
              <StepNumber n={n} className="mt-0.5 h-7 w-7 text-sm" />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-on-surface">
                  <Icon className="h-3.5 w-3.5 text-on-surface-variant" aria-hidden="true" />
                  {t(titleKey)}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{t(bodyKey)}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Not a fourth step: these are the two things people reach for once
            they have made one statement. As one prose sentence nobody found
            them; two labeled items keep them scannable without adding a step. */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 border-t border-outline-variant/20 pt-5 sm:grid-cols-2">
          {(
            [
              { icon: Files, titleKey: "welcomeDraftsTitle", bodyKey: "welcomeDraftsBody" },
              { icon: Send, titleKey: "welcomeAskTitle", bodyKey: "welcomeAskBody" },
            ] as const
          ).map(({ icon: Icon, titleKey, bodyKey }) => (
            <div key={titleKey} className="flex gap-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-on-surface">{t(titleKey)}</p>
                <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{t(bodyKey)}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {hasAuthors ? (
            // Re-opened over existing work, so no data-replacing action.
            <button
              type="button"
              onClick={closeWelcome}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-container"
            >
              {t("gotIt")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  loadSample(t("sampleNames").split("\n"));
                  closeWelcome();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-container"
              >
                <Sparkles className="h-4 w-4" />
                {t("loadSample")}
              </button>
              <button
                type="button"
                onClick={closeWelcome}
                className="text-sm font-medium text-on-surface-variant transition-colors hover:text-primary"
              >
                {t("startFresh")}
              </button>
            </>
          )}
          <span className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:ml-auto">
            {/* The one thing this card never says: what the app itself is, and
                what it is built on. */}
            <AboutPopover version={version} container={dialogEl} />
            <a
              href="https://credit.niso.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary"
            >
              {t("fullCreditStandard")}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{t("opensInNewTab")}</span>
            </a>
            <a
              href="https://doi.org/10.5281/zenodo.18421449"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary"
            >
              {t("creditRolesExamples")}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{t("opensInNewTab")}</span>
            </a>
          </span>
        </div>
      </div>
    </dialog>
  );
}
