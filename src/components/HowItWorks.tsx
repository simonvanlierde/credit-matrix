"use client";

import { HelpCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "use-intl";
import { useContributionStore } from "@/store/contribution-store";

/** Re-opens the welcome modal. Ephemeral: the re-open isn't persisted, so it
 *  never resurfaces as a fake first run on the next visit. The modal lives on
 *  the main page only, so elsewhere this is a link that opens it there (see
 *  WelcomeCard's hash check). */
export function HowItWorks() {
  const openWelcome = useContributionStore((s) => s.openWelcome);
  const welcomeOpen = useContributionStore((s) => s.welcomeOpen);
  const onMainPage = usePathname() === "/";
  const t = useTranslations();
  const className =
    "inline-flex items-center gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary";
  const label = (
    <>
      <HelpCircle className="size-3.5" aria-hidden="true" />
      {t("howItWorks")}
    </>
  );
  if (!onMainPage) {
    return (
      <a href="/#getting-started" className={className}>
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={welcomeOpen}
      aria-controls="getting-started"
      onClick={openWelcome}
      className={className}
    >
      {label}
    </button>
  );
}
