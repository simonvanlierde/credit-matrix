"use client";

import { ChartLine } from "lucide-react";
import { useTranslations } from "use-intl";

/** The census page from the header nav. From xl only: at lg the nav already fills the row, and the About panel links it there. */
export function CensusLink() {
  const t = useTranslations();
  return (
    <a
      href="/census"
      className="hidden items-center whitespace-nowrap xl:inline-flex gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary"
    >
      <ChartLine className="size-3.5" aria-hidden="true" />
      {t("censusTitle")}
    </a>
  );
}
