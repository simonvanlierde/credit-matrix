import type { Messages } from "@lingui/core";
import { type ReactNode, useEffect, useState } from "react";
import { hasCatalog, type LocaleCode, normalizeLocaleCode } from "@/core/i18n";
import { reloadForNewBuild } from "@/lib/reload-for-new-build";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";

/** Interface language is a saved preference, independent of the statement language. */

/**
 * The interface language a browser asks for: the first of its preferred
 * languages that has a catalog, else English. Regions fold into the catalog
 * that serves them (pt-BR → pt-PT), except that Traditional Chinese is not
 * served by the Simplified catalog.
 */
export function detectUiLocale(languages: readonly string[]): LocaleCode {
  for (const tag of languages) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(tag).maximize();
    } catch {
      continue;
    }
    if (locale.language === "en") return "en";
    if (locale.language === "zh" && locale.script !== "Hans") continue;
    const code = normalizeLocaleCode(locale.language);
    if (code !== "en") return code;
  }
  return "en";
}

/**
 * On a first visit, before anyone has picked a language, start in the
 * browser's. Once the store persists, uiLocale is saved with it, so this
 * runs once per browser, and an explicit choice (English included) wins.
 */
function useFirstVisitUiLocale() {
  useEffect(() => {
    const { persist } = useContributionStore;
    let chosen: boolean;
    try {
      const raw = window.localStorage.getItem(persist.getOptions().name ?? "");
      chosen = raw !== null && JSON.parse(raw)?.state?.uiLocale !== undefined;
    } catch {
      // Storage blocked or unreadable: nothing would persist the pick anyway.
      return;
    }
    if (chosen) return;
    const apply = () => {
      const detected = detectUiLocale(navigator.languages ?? []);
      if (detected !== "en") useContributionStore.getState().setUiLocale(detected);
    };
    if (persist.hasHydrated()) apply();
    else return persist.onFinishHydration(apply);
  }, []);
}

export function AppIntlProvider({ children }: { children: ReactNode }) {
  useFirstVisitUiLocale();
  const locale = useContributionStore((s) => s.uiLocale);
  const [loaded, setLoaded] = useState<{ requested: LocaleCode; effective: LocaleCode; messages: Messages }>({
    requested: "en",
    effective: "en",
    messages: en,
  });
  const current = loaded.requested === locale ? loaded : { requested: locale, effective: "en" as const, messages: en };

  useEffect(() => {
    let active = true;
    if (!hasCatalog(locale)) {
      setLoaded({ requested: locale, effective: "en", messages: en });
      return;
    }
    (import(`../locales/${locale}/messages.ts`) as Promise<{ messages: Messages }>)
      .then((mod) => {
        if (active) setLoaded({ requested: locale, effective: locale, messages: mod.messages });
      })
      .catch(() => {
        // A locale chunk failed to load: after a deploy, reload into the new
        // build. Otherwise English is a working interface; a crash is not.
        if (active && !reloadForNewBuild()) setLoaded({ requested: locale, effective: "en", messages: en });
      });
    return () => {
      active = false;
    };
  }, [locale]);

  // Keep the document's declared language in step with the interface. The page
  // is server-rendered as `en`, and the store only knows the reader's choice
  // after it rehydrates, so this is a client-side correction rather than an SSR
  // attribute. Without it a Dutch interface still announces itself as English
  // and a screen reader applies English pronunciation to every label.
  useEffect(() => {
    document.documentElement.lang = current.effective;
  }, [current.effective]);

  return (
    <IntlProvider locale={current.effective} messages={current.messages}>
      {children}
    </IntlProvider>
  );
}
