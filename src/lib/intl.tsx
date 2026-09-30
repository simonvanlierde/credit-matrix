"use client";

import { type ReactNode, useEffect, useState } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import { type LocaleCode, normalizeLocaleCode } from "@/core";
import { announce, STORAGE_FULL_EVENT } from "@/lib/announce";
import en from "@/messages/en.json";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Interface translation, on `use-intl`.
 *
 * The locale comes from the store, not the URL: it is a display preference that
 * belongs to the person, and it is deliberately independent of `outputLocale`
 * (someone may want a Dutch interface and an English statement). That is why
 * this is `use-intl` rather than its `next-intl` wrapper — the routing,
 * middleware, and server-message machinery has nothing to do here, and would
 * add native build dependencies for no gain.
 *
 * English is bundled as the source and the fallback. Other locales load lazily,
 * one chunk each, so only the selected language ships.
 */

/** Messages are flat key → ICU string; English defines the shape. */
export type Messages = typeof en;

/**
 * One entry per non-English locale, typed against {@link LocaleCode}.
 *
 * Adding a language to AVAILABLE_LOCALES without an interface catalog is a
 * compile error here, rather than a picker that offers a language and then
 * silently renders English.
 */
const LOADERS: Record<Exclude<LocaleCode, "en">, () => Promise<{ default: Messages }>> = {
  fr: () => import("@/messages/fr.json"),
  de: () => import("@/messages/de.json"),
  es: () => import("@/messages/es.json"),
  it: () => import("@/messages/it.json"),
  "pt-PT": () => import("@/messages/pt.json"),
  nl: () => import("@/messages/nl.json"),
  "zh-Hans": () => import("@/messages/zh.json"),
  ja: () => import("@/messages/ja.json"),
};

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
    const load = Object.hasOwn(LOADERS, locale) ? LOADERS[locale as Exclude<LocaleCode, "en">] : undefined;
    if (!load) {
      setLoaded({ requested: locale, effective: "en", messages: en });
      return;
    }
    load()
      .then((mod) => {
        if (active) setLoaded({ requested: locale, effective: locale, messages: mod.default });
      })
      .catch(() => {
        // A locale chunk failed to load (e.g. a stale deploy). English is a
        // working interface; a missing-message crash is not.
        if (active) setLoaded({ requested: locale, effective: "en", messages: en });
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
    <IntlProvider
      locale={current.effective}
      messages={current.messages}
      // Never blank a control: fall back to the English text, then the key.
      getMessageFallback={({ key }) => (en as Record<string, string>)[key] ?? key}
      onError={() => {
        // use-intl logs missing keys to the console by default. The fallback
        // above already renders something sensible, so stay quiet.
      }}
    >
      <LocalizedSystemAnnouncements />
      {children}
    </IntlProvider>
  );
}

function LocalizedSystemAnnouncements() {
  const t = useTranslations();
  useEffect(() => {
    const onStorageFull = () => announce(t("errStorageFull"), { assertive: true });
    window.addEventListener(STORAGE_FULL_EVENT, onStorageFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onStorageFull);
  }, [t]);
  return null;
}
