"use client";

import { useTranslations } from "use-intl";

const LINK =
  "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-primary focus:shadow-lg";

/**
 * First focusable elements: let keyboard users bypass the header, and jump
 * past the contributor rail to the grid or past the grid to the statement.
 */
export function SkipLink() {
  const t = useTranslations();
  return (
    <>
      <a href="#main-content" className={LINK}>
        {t("skipToContent")}
      </a>
      <a href="#grid" data-workspace-skip className={LINK}>
        {t("skipToGrid")}
      </a>
      <a href="#inspector" data-workspace-skip className={LINK}>
        {t("skipToStatement")}
      </a>
    </>
  );
}
