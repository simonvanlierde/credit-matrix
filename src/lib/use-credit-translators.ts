"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_ROLE_TRANSLATOR,
  DEFAULT_UI_TRANSLATOR,
  getRoleByName,
  type LocaleCode,
  loadRoleCatalog,
  loadUiCatalog,
  makeRoleDescriber,
  makeRoleTranslator,
  makeUiTranslator,
  type RoleDescriber,
  type RoleTranslator,
  type UiTranslator,
} from "@/core";
import { reloadForNewBuild } from "@/lib/reload-for-new-build";
import { useContributionStore } from "@/store/contribution-store";

/** Canonical English description, from the bundled role catalog. */
const ENGLISH_DESCRIPTION: RoleDescriber = (name) => {
  try {
    return getRoleByName(name).description;
  } catch {
    return "";
  }
};

interface CreditTranslators {
  /** Role name, in the OUTPUT language: it must match the statement it lands in. */
  translateRole: RoleTranslator;
  /** Non-role output strings (level labels, "Acknowledgements"), OUTPUT language. */
  translateUi: UiTranslator;
  /** Role description, in the INTERFACE language: help text that never gets exported. */
  describeRole: RoleDescriber;
  /** Role name used in controls and validation, in the interface language. */
  translateInterfaceRole: RoleTranslator;
  /** Contribution-level labels used in controls, in the interface language. */
  translateInterfaceUi: UiTranslator;
  /** Actual language of generated output, including a truthful fallback. */
  outputLanguage: LocaleCode;
  /** Actual language of role help text, including a truthful fallback. */
  interfaceRoleLanguage: LocaleCode;
}

const ENGLISH: CreditTranslators = {
  translateRole: DEFAULT_ROLE_TRANSLATOR,
  translateUi: DEFAULT_UI_TRANSLATOR,
  describeRole: ENGLISH_DESCRIPTION,
  translateInterfaceRole: DEFAULT_ROLE_TRANSLATOR,
  translateInterfaceUi: DEFAULT_UI_TRANSLATOR,
  outputLanguage: "en",
  interfaceRoleLanguage: "en",
};

interface LoadedTranslators extends CreditTranslators {
  requestedOutputLocale: LocaleCode;
  requestedUiLocale: LocaleCode;
}

/**
 * Everything that reads the vendored CRediT catalog, in one subscription.
 *
 * The app has two languages on purpose — someone may want a Dutch interface and
 * an English statement — and the catalog carries both a name and a description
 * per role. Those two fields follow *different* languages: a name has to match
 * the statement it will appear in, a description is help the reader is reading
 * now. That is the whole reason this is not a single lookup.
 *
 * Kept as one hook rather than one per field so the common case (both languages
 * the same) fetches the catalog once instead of twice.
 *
 * Interface strings are not here: those are use-intl's `useTranslations`, which
 * every component already uses and which needs no catalog of its own.
 */
export function useCreditTranslators(): CreditTranslators {
  const outputLocale = useContributionStore((s) => s.outputLocale);
  const uiLocale = useContributionStore((s) => s.uiLocale);
  const [loaded, setLoaded] = useState<LoadedTranslators>({
    ...ENGLISH,
    requestedOutputLocale: "en",
    requestedUiLocale: "en",
  });
  const translators =
    loaded.requestedOutputLocale === outputLocale && loaded.requestedUiLocale === uiLocale ? loaded : ENGLISH;

  useEffect(() => {
    let active = true;
    const sameLocale = outputLocale === uiLocale;

    Promise.all([
      loadRoleCatalog(outputLocale),
      loadUiCatalog(outputLocale),
      // Skip the second fetch when both languages agree, which is the default.
      sameLocale ? null : loadRoleCatalog(uiLocale),
      sameLocale ? null : loadUiCatalog(uiLocale),
    ])
      .then(([outputRoles, outputUi, uiRoles, uiUi]) => {
        if (!active) return;
        setLoaded({
          translateRole: makeRoleTranslator(outputRoles),
          translateUi: makeUiTranslator(outputUi),
          describeRole: makeRoleDescriber(sameLocale ? outputRoles : uiRoles, ENGLISH_DESCRIPTION),
          translateInterfaceRole: makeRoleTranslator(sameLocale ? outputRoles : uiRoles),
          translateInterfaceUi: makeUiTranslator(sameLocale ? outputUi : uiUi),
          outputLanguage: outputLocale,
          interfaceRoleLanguage: uiLocale,
          requestedOutputLocale: outputLocale,
          requestedUiLocale: uiLocale,
        });
      })
      .catch(() => {
        // A locale chunk failed to load: after a deploy, reload into the new
        // build. Otherwise English is a working interface; a crash is not.
        if (active && !reloadForNewBuild())
          setLoaded({
            ...ENGLISH,
            requestedOutputLocale: outputLocale,
            requestedUiLocale: uiLocale,
          });
      });

    return () => {
      active = false;
    };
  }, [outputLocale, uiLocale]);

  return translators;
}
