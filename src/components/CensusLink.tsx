"use client";

import { ChartLine } from "lucide-react";
import { useTranslations } from "@/lib/translations";

/**
 * The census page from the header nav. At lg the nav is nearly full, so it is the icon alone, with
 * the name kept for screen readers and as a tooltip; from xl the name shows. Below lg the brand
 * menu links it instead.
 */
export function CensusLink() {
  const t = useTranslations();
  return (
    <a
      href="/census"
      title={t("censusTitle")}
      className="touch-target inline-flex items-center justify-center whitespace-nowrap gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary"
    >
      <ChartLine className="size-4 xl:size-3.5" aria-hidden="true" />
      <span className="sr-only xl:not-sr-only">{t("censusTitle")}</span>
    </a>
  );
}
