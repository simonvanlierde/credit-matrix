import { Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ExternalLink } from "@/components/ui/external-link";
import type { Toolchain } from "@/core/toolchain";
import { docFiles } from "@/docs/pages";
import { type HeatmapRecipeTarget, heatmapRecipe } from "@/lib/heatmap-recipe";
import type { HeatmapOptions } from "@/lib/heatmap-settings";
import { useTranslations } from "@/lib/translations";
import { useCopyStatus } from "@/lib/use-copy-status";
import { TOOL_BUTTON } from "./grid-shared";

export const TOOLCHAIN_OUTPUTS = {
  word: {
    label: "Word",
    format: null,
    recipe: "cli",
    setup: null,
    guide: "integrations/figures/README.md",
  },
  markdown: { label: "Markdown", format: "markdown", recipe: "cli", setup: null, guide: null },
  latex: {
    label: "LaTeX",
    format: "latex",
    recipe: "cli",
    setup: "\\usepackage{credits,svg}",
    guide: "https://github.com/Pseudomanifold/latex-credits",
  },
  quarto: {
    label: "Quarto",
    format: "quarto",
    recipe: "quarto",
    setup: "quarto add simonvanlierde/credit-matrix/integrations/quarto",
    guide: "integrations/quarto/README.md",
  },
  typst: {
    label: "Typst",
    format: "json",
    recipe: "typst",
    setup: '#import "@preview/credit-matrix:0.12.0": *',
    guide: "integrations/typst/README.md",
  },
  pandoc: {
    label: "Pandoc",
    format: "quarto",
    recipe: "quarto",
    setup: "pandoc paper.md --lua-filter=credit-matrix.lua -o paper.html",
    guide: "integrations/pandoc/README.md",
  },
  myst: {
    label: "MyST / Jupyter Book",
    format: "myst",
    recipe: "myst",
    setup: "project: {plugins: [https://unpkg.com/credit-matrix@0.12.0/dist/myst-plugin.mjs]}",
    guide: "integrations/myst/README.md",
  },
  sphinx: {
    label: "Sphinx",
    format: "json",
    recipe: "sphinx",
    setup: 'extensions = ["credit_matrix"]',
    guide: "integrations/sphinx/README.md",
  },
} as const satisfies Record<
  Toolchain,
  { label: string; format: string | null; recipe: HeatmapRecipeTarget; setup: string | null; guide: string | null }
>;

function CopySnippet({ label, text, rows = 4 }: { label: string; text: string; rows?: number }) {
  const t = useTranslations();
  const [status, copy] = useCopyStatus();
  const [lastCopy, setLastCopy] = useState<string>();
  const currentStatus = lastCopy === text ? status : "idle";
  return (
    <div className="grid min-w-0 gap-1.5">
      <textarea
        aria-label={label}
        value={text}
        readOnly
        rows={rows}
        spellCheck={false}
        className="w-full min-w-0 resize-y rounded border border-edge bg-surface-bright p-2 font-mono text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <button
        type="button"
        onClick={() => {
          setLastCopy(text);
          void copy(text);
        }}
        className={`${TOOL_BUTTON} justify-self-start`}
      >
        <Copy className="size-3.5" aria-hidden="true" />
        {currentStatus === "copied"
          ? t("copied")
          : currentStatus === "error"
            ? t("copyFailedMessage")
            : t("copyFormat", { format: label })}
      </button>
    </div>
  );
}

export function ToolchainPanel({
  toolchain,
  settings,
  language,
  children,
}: {
  toolchain: Toolchain;
  settings: HeatmapOptions;
  language: string;
  children: ReactNode;
}) {
  const t = useTranslations();
  const config = TOOLCHAIN_OUTPUTS[toolchain];
  const guide = docFiles.find((file) => file.path === config.guide);
  const cli = heatmapRecipe(settings, "cli", language);
  // Figure settings links here; for CLI-recipe tools the CLI command is the recipe, so the link lands on it.
  const anchor = { id: "toolchain-heatmap-recipe", tabIndex: -1 };
  const cliRecipe = config.recipe === "cli";
  const recipe = `${toolchain === "typst" ? '#let team = json("contributors.json")\n\n' : ""}${heatmapRecipe(settings, config.recipe, language)}`;
  return (
    <section
      aria-label={t("toolchainPanel", { toolchain: config.label })}
      className="grid min-w-0 gap-3 border-t border-outline-variant/40 pt-3 text-xs"
    >
      <h3 className="font-semibold text-sm text-on-surface">{t("toolchainPanel", { toolchain: config.label })}</h3>
      {children}
      {toolchain === "word" && <p className="text-on-surface-variant">{t("toolchainWordHint")}</p>}
      {toolchain !== "word" && (
        <div {...(cliRecipe ? {} : anchor)} className="grid min-w-0 gap-2 scroll-mt-4">
          <h4 className="font-semibold">{t("heatmapRecipe")}</h4>
          {toolchain === "latex" && <p className="text-on-surface-variant">{t("toolchainLatexHeatmap")}</p>}
          {settings.colorBy === "contributor" && (
            <p className="text-on-surface-variant">{t("heatmapRecipeOneColor")}</p>
          )}
          {toolchain === "myst" && <p className="text-on-surface-variant">{t("heatmapRecipeMyst")}</p>}
          {toolchain === "typst" && <p className="text-on-surface-variant">{t("heatmapRecipeTypst")}</p>}
          {!cliRecipe && <CopySnippet label={t("heatmapRecipe")} text={recipe} rows={6} />}
          {toolchain === "latex" && <CopySnippet label="LaTeX" text={"\\includesvg{heatmap}"} rows={2} />}
          {toolchain === "markdown" && <CopySnippet label="Markdown" text="![CRediT](heatmap.svg)" rows={2} />}
        </div>
      )}
      <div className="grid min-w-0 gap-2">
        <h4 className="font-semibold">{t("toolchainSetup")}</h4>
        {config.setup ? (
          <CopySnippet label={t("toolchainSetup")} text={config.setup} rows={2} />
        ) : (
          <p className="text-on-surface-variant">{t("toolchainNoSetup")}</p>
        )}
        {guide ? (
          <a href={guide.route} className="inline-flex min-h-6 items-center text-primary hover:underline">
            {t("toolchainSetupLink", { toolchain: config.label })}
          </a>
        ) : (
          config.guide && (
            <ExternalLink href={config.guide} className="min-h-6 gap-1 text-primary hover:underline">
              {t("toolchainSetupLink", { toolchain: config.label })}
            </ExternalLink>
          )
        )}
      </div>
      <div {...(cliRecipe ? anchor : {})} className="grid min-w-0 gap-2 scroll-mt-4">
        <h4 className="font-semibold">{t("toolchainCli")}</h4>
        <p className="text-on-surface-variant">{t("toolchainDataHint")}</p>
        <CopySnippet label={t("toolchainCli")} text={cli} rows={4} />
      </div>
    </section>
  );
}
