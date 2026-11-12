import { useId, useMemo, useState } from "react";
import { TOOL_BUTTON } from "@/components/steps/grid-shared";
import { OutputBlock } from "@/components/steps/OutputBlock";
import { TOOLCHAIN_OUTPUTS, ToolchainPanel } from "@/components/steps/ToolchainPanel";
import { DEFAULT_MONO_COLOR } from "@/core/contributor-color";
import { DEFAULT_HEATMAP_SETTINGS, type HeatmapOptions } from "@/lib/heatmap-settings";
import { useLocale, useTranslations } from "@/lib/translations";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useHeatmapSettings } from "@/lib/use-heatmap-settings";
import { useHydrated } from "@/lib/use-hydrated";
import { buildSampleAuthors, useContributionStore } from "@/store/contribution-store";
import type { LiveTarget } from "./live-markers";

export default function LiveExample({ target }: { target: LiveTarget }) {
  const t = useTranslations();
  const locale = useLocale();
  const hydrated = useHydrated();
  const recipeId = useId();
  const [useSample, setUseSample] = useState(false);
  const draftAuthors = useContributionStore((s) => s.authors);
  const inputMode = useContributionStore((s) => s.inputMode);
  const { translateRole, translateUi, outputLanguage } = useCreditTranslators();
  const names = t("sampleNames");
  const sampleAuthors = useMemo(() => buildSampleAuthors(names.split("\n")), [names]);
  const hasDraft = hydrated && draftAuthors.length > 0;
  const showingDraft = hasDraft && !useSample;
  const authors = showingDraft ? draftAuthors : sampleAuthors;
  const yesNo = showingDraft && inputMode === "toggle";
  const draftSettings = useHeatmapSettings(!yesNo);
  const settings: HeatmapOptions = showingDraft
    ? draftSettings
    : { ...DEFAULT_HEATMAP_SETTINGS, color: DEFAULT_MONO_COLOR, colorBy: "color", horizontal: false, acronyms: false };
  const output = (
    <OutputBlock
      authors={authors}
      format={target === "ro-crate" ? "ro-crate" : TOOLCHAIN_OUTPUTS[target].format}
      options={{ includeAnswers: false, yesNo, translateRole, translateUi, outputLanguage }}
      language={outputLanguage}
    />
  );

  return (
    <section
      data-doc-live
      lang={locale}
      aria-label={t("docsLiveExample")}
      className="my-6 grid min-w-0 gap-3 rounded-lg border border-edge bg-surface-container-low p-4 text-on-surface"
    >
      <p className="text-base font-semibold">{t("docsLiveExample")}</p>
      {!hydrated ? (
        <p role="status" className="text-sm text-on-surface-variant">
          {t("docsLiveLoading")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{showingDraft ? t("docsLiveDraft") : t("docsLiveSample")}</span>
            {hasDraft && (
              <button type="button" onClick={() => setUseSample(!useSample)} className={TOOL_BUTTON}>
                {showingDraft ? t("docsUseSample") : t("docsUseDraft")}
              </button>
            )}
          </div>
          {target === "ro-crate" ? (
            output
          ) : (
            <ToolchainPanel toolchain={target} settings={settings} language={outputLanguage} recipeId={recipeId}>
              {output}
            </ToolchainPanel>
          )}
        </>
      )}
    </section>
  );
}
