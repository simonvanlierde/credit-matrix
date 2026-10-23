"use client";

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

/**
 * The frame of a page to read (about, accessibility statement): a way back to
 * the app above a reading column. On a desktop the workspace locks the page to
 * the window, so this pane scrolls itself, as the census page does.
 */
export function ReadingPage({ children }: { children: ReactNode }) {
  const t = useTranslations();
  return (
    <div data-reading-page className="desk:h-full desk:overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6 pb-16 sm:px-8">
        <a href="/" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("censusBack")}
        </a>
        {children}
      </div>
    </div>
  );
}
