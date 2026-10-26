"use client";

import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { AboutPanel } from "@/components/AboutPanel";
import { Lockup, PRODUCT_NAME } from "@/components/BrandMark";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Below `lg` the header has no room left for the "How it works" and "About"
 * links: the controls alone are already ~440px once they carry labels. The lockup is the
 * one element up there with nothing to do, so it becomes their trigger —
 * tapping the product name opens what the product is and how it works.
 *
 * The chevron is what earns that: without it the lockup reads as a title, and a
 * title nobody taps hides the two links just as well as the old `hidden md:flex`
 * did. It hides from `lg`, exactly where the nav takes the links back, so the
 * two affordances never overlap and never leave a gap between them.
 */
export function BrandMenu({ version }: { version: string }) {
  const [open, setOpen] = useState(false);
  const openWelcome = useContributionStore((s) => s.openWelcome);
  const welcomeOpen = useContributionStore((s) => s.welcomeOpen);
  const onMainPage = usePathname() === "/";
  const t = useTranslations();
  const howItWorksClass =
    "touch-target flex w-full items-center gap-2.5 rounded-lg border border-outline-variant bg-surface-container-low px-3 text-left font-semibold text-on-surface transition-colors hover:border-primary hover:bg-surface-container hover:text-primary";
  const howItWorksLabel = (
    <>
      <HelpCircle className="size-4 shrink-0 text-primary" aria-hidden="true" />
      {t("howItWorks")}
      <ChevronRight className="ml-auto size-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
    </>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* -ml-1/px-1 buys hit area without moving the lockup off the header's
          left margin. */}
      <PopoverTrigger className="group touch-target -ml-1 flex shrink-0 items-center gap-2.5 rounded-lg px-1 text-primary lg:hidden">
        <Lockup />
        <ChevronDown
          className="size-3.5 shrink-0 text-on-surface-variant transition-transform duration-150 group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={PRODUCT_NAME}
        className="w-[22rem] max-w-[calc(100vw-1.5rem)] space-y-4 text-sm text-on-surface-variant"
      >
        {/* A framed row with a forward chevron: inside a panel, a bare line of
            text with an icon reads as a heading, not as the thing to tap. */}
        {/* The welcome modal lives on the main page only; elsewhere this
            links there and WelcomeCard opens it from the hash. */}
        {onMainPage ? (
          <button
            type="button"
            aria-expanded={welcomeOpen}
            aria-controls="getting-started"
            onClick={() => {
              // Close first: the welcome dialog is modal, and a popover left open
              // behind it would sit in the inert layer with no way back to it.
              setOpen(false);
              openWelcome();
            }}
            className={howItWorksClass}
          >
            {howItWorksLabel}
          </button>
        ) : (
          <a href="/#getting-started" className={howItWorksClass}>
            {howItWorksLabel}
          </a>
        )}
        <div className="space-y-3 border-t border-outline-variant/30 pt-3">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">{t("about")}</p>
          <AboutPanel version={version} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
