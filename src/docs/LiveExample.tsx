import { useId, useState } from "react";
import { TOOL_BUTTON } from "@/components/steps/grid-shared";
import { OutputBlock } from "@/components/steps/OutputBlock";
import { TOOLCHAIN_OUTPUTS } from "@/components/steps/ToolchainPanel";
import { createAuthor } from "@/core";
import { useLocale, useTranslations } from "@/lib/translations";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useHydrated } from "@/lib/use-hydrated";
import { useContributionStore } from "@/store/contribution-store";
import type { LiveTarget } from "./live-markers";

// These contributors match the static examples and their expected results in the guides.
const sampleAuthors = [
  createAuthor("Marie Curie", {
    id: "marie",
    contributions: [
      { role: "Conceptualization", score: 100 },
      { role: "Software", score: 33 },
    ],
  }),
  createAuthor("Albert Einstein", {
    id: "albert",
    contributions: [
      { role: "Formal analysis", score: 66 },
      { role: "Investigation", score: 100 },
    ],
  }),
];

export default function LiveExample({ target }: { target: LiveTarget }) {
  const t = useTranslations();
  const locale = useLocale();
  const hydrated = useHydrated();
  const sourceId = useId();
  const [useSample, setUseSample] = useState(false);
  const draftAuthors = useContributionStore((s) => s.authors);
  const inputMode = useContributionStore((s) => s.inputMode);
  const { translateRole, translateUi, outputLanguage } = useCreditTranslators();
  const hasDraft = hydrated && draftAuthors.length > 0;
  const showingDraft = hasDraft && !useSample;
  const authors = showingDraft ? draftAuthors : sampleAuthors;
  const yesNo = showingDraft && inputMode === "toggle";
  const output = (
    <OutputBlock
      authors={authors}
      format={target === "ro-crate" ? "ro-crate" : TOOLCHAIN_OUTPUTS[target].format}
      options={{ includeAnswers: false, yesNo, translateRole, translateUi, outputLanguage }}
      language={outputLanguage}
      rows={10}
      labelledBy={sourceId}
    />
  );

  return (
    <section
      data-doc-live
      lang={locale}
      aria-label={t("docsLiveExample")}
      className="my-4 grid min-w-0 gap-3 text-on-surface"
    >
      <p className="text-base font-semibold">{t("docsLiveExample")}</p>
      {!hydrated ? (
        <p role="status" className="text-sm text-on-surface-variant">
          {t("docsLiveLoading")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span id={sourceId}>{showingDraft ? t("docsLiveDraft") : t("docsLiveSample")}</span>
            {hasDraft ? (
              <button type="button" onClick={() => setUseSample(!useSample)} className={TOOL_BUTTON}>
                {showingDraft ? t("docsUseSample") : t("docsUseDraft")}
              </button>
            ) : (
              // Without a draft in this browser (a first visit, or a preview on another origin) the
              // toggle has nothing to switch to, so say where the reader's own data comes from.
              <span className="basis-full text-on-surface-variant">
                {t.rich("docsLiveMakeYourOwn", { link: (chunks) => <a href="/">{chunks}</a> })}
              </span>
            )}
          </div>
          {output}
        </>
      )}
    </section>
  );
}
