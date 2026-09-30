"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "use-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AVAILABLE_LOCALES, type LocaleCode } from "@/core";
import { useContributionStore } from "@/store/contribution-store";

/**
 * Header control for the two languages, which are deliberately independent: a
 * researcher may want a Dutch interface while submitting an English statement
 * to an English-language journal.
 *
 * - Interface: the app's own chrome.
 * - Output: role names in the generated statement, Markdown, and heatmap.
 *
 * A popover rather than a single dropdown, because a listbox may hold only
 * options — two labelled selects cannot live inside one.
 */
export function LanguageSelector() {
  const uiLocale = useContributionStore((s) => s.uiLocale);
  const setUiLocale = useContributionStore((s) => s.setUiLocale);
  const outputLocale = useContributionStore((s) => s.outputLocale);
  const setOutputLocale = useContributionStore((s) => s.setOutputLocale);
  const t = useTranslations();

  return (
    <Popover>
      {/* Broader than "Interface language": the panel also sets the output
          language, and that is the name people hunt for in the control list. */}
      <PopoverTrigger
        aria-label={t("languageSettings")}
        className="touch-target flex size-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
      >
        <Languages className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3">
        <div className="grid gap-3">
          <LocaleSelect id="ui-locale-label" label={t("interfaceLanguage")} value={uiLocale} onChange={setUiLocale} />
          <LocaleSelect
            id="output-locale-label"
            label={t("outputLanguage")}
            value={outputLocale}
            onChange={setOutputLocale}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One labelled locale picker. A Radix trigger is a button, not a form control,
 * so <label> cannot associate with it: point the trigger at the visible text.
 */
function LocaleSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: LocaleCode;
  onChange: (locale: LocaleCode) => void;
}) {
  return (
    <div className="grid gap-1.5 text-xs font-medium text-on-surface">
      <span id={id}>{label}</span>
      <Select value={value} onValueChange={(next) => onChange(next as LocaleCode)}>
        <SelectTrigger aria-labelledby={id} className="w-full text-xs font-normal">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AVAILABLE_LOCALES.map((locale) => (
            <SelectItem key={locale.code} value={locale.code}>
              {locale.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
