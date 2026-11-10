import { Copy } from "lucide-react";
import { useId, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type HeatmapRecipeTarget, heatmapRecipe } from "@/lib/heatmap-recipe";
import type { HeatmapFigureSettings } from "@/lib/heatmap-settings";
import { useTranslations } from "@/lib/translations";
import { useCopyStatus } from "@/lib/use-copy-status";
import { TOOL_BUTTON } from "./grid-shared";

export function HeatmapRecipe({ settings, language }: { settings: HeatmapFigureSettings; language: string }) {
  const t = useTranslations();
  const id = useId();
  const [target, setTarget] = useState<HeatmapRecipeTarget>("cli");
  const [status, copy] = useCopyStatus();
  const [lastCopy, setLastCopy] = useState<string | null>(null);
  const recipe = heatmapRecipe(settings, target, language);
  const currentStatus = lastCopy === recipe ? status : "idle";
  return (
    <details className="border-t border-outline-variant/40 pt-3 text-xs">
      <summary className="min-h-6 cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {t("heatmapRecipe")}
      </summary>
      <div className="mt-2 grid gap-2">
        <p className="text-on-surface-variant">{t("heatmapRecipeHint")}</p>
        <label htmlFor={id} className="text-on-surface-variant">
          {t("heatmapRecipeTarget")}
        </label>
        <Select value={target} onValueChange={(value) => setTarget(value as HeatmapRecipeTarget)}>
          <SelectTrigger id={id} className="min-h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              [
                ["cli", "CLI"],
                ["sphinx", "Sphinx"],
                ["quarto", "Quarto / Pandoc"],
                ["myst", "MyST / Jupyter Book"],
                ["typst", "Typst"],
              ] as const
            ).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {target === "myst" && <p className="text-on-surface-variant">{t("heatmapRecipeMyst")}</p>}
        {target === "typst" && <p className="text-on-surface-variant">{t("heatmapRecipeTypst")}</p>}
        <textarea
          aria-label={t("heatmapRecipe")}
          value={recipe}
          readOnly
          rows={8}
          spellCheck={false}
          className="min-h-24 w-full resize-y rounded border border-outline-variant bg-surface-bright p-2 font-mono text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={async () => {
            await copy(recipe);
            setLastCopy(recipe);
          }}
          className={`${TOOL_BUTTON} justify-center`}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          {currentStatus === "copied"
            ? t("copied")
            : currentStatus === "error"
              ? t("copyFailedMessage")
              : t("heatmapCopyRecipe")}
        </button>
      </div>
    </details>
  );
}
