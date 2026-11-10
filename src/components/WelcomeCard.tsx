import { Files, Fingerprint, Info, Send, Sparkles, TableProperties, TextQuote, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "@/components/ui/external-link";
import { StepNumber } from "@/components/ui/step-number";
import { closeOnBackdrop, useModalDialog } from "@/lib/dialog";
import { useTranslations } from "@/lib/translations";
import { useHydrated } from "@/lib/use-hydrated";
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
export function WelcomeCard() {
  const welcomeOpen = useContributionStore((s) => s.welcomeOpen);
  const closeWelcome = useContributionStore((s) => s.closeWelcome);
  const loadSample = useContributionStore((s) => s.loadSample);
  const hasAuthors = useContributionStore((s) => s.authors.length > 0);
  const t = useTranslations();

  // The store uses skipHydration (see contribution-store.ts), so the persisted
  // flags aren't known until HeaderActions triggers rehydration. Gate on that,
  // then auto-open exactly once for a first-time visitor.
  const hydrated = useHydrated();
  // State, not a ref, so useModalDialog's effect runs again once the element mounts.
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  // Set by "Start fresh": its next step is typing the first name.
  const startFresh = useRef(false);
  // False until the first-run decision below is made. The prerendered card is visible from the
  // first paint (data-first-run, see globals.css) and stays so until it is closed or declined, so
  // it never blinks out between the prerendered look and showModal(). A returning visitor's is
  // hidden by the inline script in index.html.
  const [decided, setDecided] = useState(false);
  useEffect(() => {
    if (!hydrated || !dialogEl) return;
    const state = useContributionStore.getState();
    // A link arrival brings its own onboarding (a claim opens the co-author
    // page, even after a reload), so the welcome must not land on top of
    // it. The hash is still here at
    // hydration (the router strips it later), and `welcomeSeen` stays false
    // so a later plain visit still gets greeted.
    const arrivedOnShareLink = window.location.hash.startsWith("#s=");
    // "How it works" on the other pages links here with this hash. Dropped
    // once read, so a reload after closing the card does not open it again.
    const askedFor = window.location.hash === "#getting-started";
    if (askedFor) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (askedFor || !(state.welcomeSeen || arrivedOnShareLink || state.claim)) {
      state.openWelcome();
    }
    setDecided(true);
  }, [hydrated, dialogEl]);

  // Drive the native dialog from the store flag, so the header's "How it works"
  // and the first-run auto-open share one code path.
  useModalDialog(dialogEl, welcomeOpen);

  return (
    <dialog
      ref={setDialogEl}
      id="getting-started"
      data-first-run={decided && !welcomeOpen ? undefined : ""}
      aria-labelledby="getting-started-title"
      onClose={(event) => {
        closeWelcome();
        // Opened on arrival, the dialog has no opener to give focus back to, so
        // focus would stay inside it and then drop to <body>.
        const focused = document.activeElement;
        const dropped = !focused || focused === document.body || event.currentTarget.contains(focused);
        const addField = startFresh.current ? document.getElementById("add-contributor") : null;
        startFresh.current = false;
        // The add field is absent on a locked draft, so fall back to the workspace.
        if (addField) addField.focus();
        else if (dropped) document.getElementById("main-content")?.focus();
      }}
      {...closeOnBackdrop}
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
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-hover"
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
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-hover"
              >
                <Sparkles className="h-4 w-4" />
                {t("loadSample")}
              </button>
              <button
                type="button"
                onClick={() => {
                  startFresh.current = true;
                  closeWelcome();
                }}
                className="text-sm font-medium text-on-surface-variant transition-colors hover:text-primary"
              >
                {t("startFresh")}
              </button>
            </>
          )}
        </div>
        {/* Its own row under a rule: beside the actions it wrapped at an arbitrary point. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-outline-variant/40 pt-4">
          {/* What the app itself is, and what it is built on. A page, not a popover: a panel opened
              over this dialog covered its own steps. */}
          <a
            href="/about"
            className="inline-flex items-center gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            <Info className="size-3.5" aria-hidden="true" />
            {t("aboutApp")}
          </a>
          <ExternalLink
            href="https://credit.niso.org"
            className="gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            {t("fullCreditStandard")}
          </ExternalLink>
          <ExternalLink
            href="https://doi.org/10.5281/zenodo.18421449"
            className="gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            {t("creditRolesExamples")}
          </ExternalLink>
        </div>
      </div>
    </dialog>
  );
}
