"use client";

import { Accessibility, BookOpen, ChartLine, Code } from "lucide-react";
import { useTranslations } from "use-intl";
import { PRODUCT_NAME } from "@/components/BrandMark";
import { ExternalLink } from "@/components/ui/external-link";

/**
 * A short card on what the app is, linking to the pages that say more: the
 * about page (citing, acknowledgements, privacy) and the accessibility
 * statement. Lives apart from its trigger because three surfaces open it: the
 * desktop nav link, the mobile brand menu, and the welcome modal. One body, so they can never disagree.
 *
 * `version` is read from package.json by the (server) layout and page, so the
 * manifest never reaches the client bundle.
 */
export function AboutPanel({ version }: { version: string }) {
  const t = useTranslations();
  return (
    <>
      <div>
        <p className="font-semibold text-on-surface">
          {PRODUCT_NAME} <span className="font-mono text-xs font-normal text-on-surface-variant">v{version}</span>
        </p>
        <p className="mt-0.5">{t("aboutTagline")}</p>
      </div>
      <a href="/about" className="flex items-center gap-1.5 font-medium text-primary hover:underline">
        <BookOpen className="size-4" aria-hidden="true" />
        {t("aboutPageLink")}
      </a>
      <a href="/accessibility" className="flex items-center gap-1.5 font-medium text-primary hover:underline">
        <Accessibility className="size-4" aria-hidden="true" />
        {t("accessibilityStatement")}
      </a>
      <a href="/census" className="flex items-center gap-1.5 font-medium text-primary hover:underline">
        <ChartLine className="size-4" aria-hidden="true" />
        {t("censusAboutLink")}
      </a>
      <ExternalLink
        href="https://github.com/simonvanlierde/credit-matrix"
        className="gap-1.5 font-medium text-primary hover:underline"
      >
        <Code className="size-4" aria-hidden="true" />
        {t("sourceOnGitHub")}
      </ExternalLink>
    </>
  );
}
