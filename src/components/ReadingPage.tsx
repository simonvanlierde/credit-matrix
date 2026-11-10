import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "@/lib/translations";

/**
 * The frame of a page to read (about, accessibility statement): a way back to
 * the app above a reading column, as wide as the census page's so the two read alike.
 * On a desktop the workspace locks the page to the window, so this pane scrolls
 * itself, as the census page does.
 */
export function ReadingPage({ children }: { children: ReactNode }) {
  const t = useTranslations();
  return (
    <div data-reading-page className="desk:h-full desk:overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-16 sm:px-8">
        {/* From lg the header's lockup links home; below it the lockup opens the menu. */}
        <a href="/" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline lg:hidden">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("censusBack")}
        </a>
        {children}
      </div>
    </div>
  );
}
