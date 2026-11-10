import { type Messages, setupI18n } from "@lingui/core";
import type { LocaleCode } from "./index";

const CATALOGS = {
  fr: () => import("./locales/fr/messages"),
  de: () => import("./locales/de/messages"),
  es: () => import("./locales/es/messages"),
  it: () => import("./locales/it/messages"),
  "pt-PT": () => import("./locales/pt-PT/messages"),
  nl: () => import("./locales/nl/messages"),
  "zh-Hans": () => import("./locales/zh-Hans/messages"),
  ja: () => import("./locales/ja/messages"),
} satisfies Record<Exclude<LocaleCode, "en">, () => Promise<{ messages: Messages }>>;

export async function loadCatalog(locale: Exclude<LocaleCode, "en">) {
  const { messages } = await CATALOGS[locale]();
  return setupI18n({ locale, messages: { [locale]: messages } });
}
