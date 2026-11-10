import { type Messages, setupI18n } from "@lingui/core";
import { I18nProvider, Trans, useLingui } from "@lingui/react";
import { createElement, type ReactNode, useMemo } from "react";
import type { MessageKey } from "@/locales/keys";

/** A separate instance keeps interface and exported statement languages independent. */
export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Messages;
  children: ReactNode;
}) {
  const i18n = useMemo(() => setupI18n({ locale, messages: { [locale]: messages } }), [locale, messages]);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

export function useTranslations() {
  const { _ } = useLingui();
  return Object.assign((key: MessageKey, values?: Record<string, string | number | Date>) => _(key, values), {
    rich(key: MessageKey, values: Record<string, string | number | ((chunks: ReactNode) => ReactNode)>) {
      const components = Object.fromEntries(
        Object.entries(values)
          .filter(([, value]) => typeof value === "function")
          .map(([name, render]) => [
            name,
            createElement(
              ({ children }: { children?: ReactNode }) => (render as (chunks: ReactNode) => ReactNode)(children),
              { key: name },
            ),
          ]),
      );
      return <Trans id={key} values={values} components={components} />;
    },
  });
}

export function useLocale() {
  return useLingui().i18n.locale;
}

export function useFormatter() {
  const locale = useLocale();
  return {
    list: (value: string[], options?: Intl.ListFormatOptions) => new Intl.ListFormat(locale, options).format(value),
    number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value),
    dateTime: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, options).format(value),
  };
}
