"use client";

import { ChevronDown, Copy, Download } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type Author, buildHeatmapSvg, heatmapDescription } from "@/core";
import { announce } from "@/lib/announce";
import { withPngText } from "@/lib/png-text";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { download as downloadBlob } from "@/lib/utils";
import { MENU_ITEM, TOOL_BUTTON } from "./grid-shared";

type ExportFormat = "svg" | "png";

/**
 * Rasterise an SVG string to a PNG Blob entirely in the browser, with no
 * server round-trip.
 *
 * 3×, not 2×: at the default 22px cell a single-column journal figure comes
 * out around 500 CSS px wide, which 2× rasterises to ~3.4in at 300 dpi — under
 * the 85mm single-column width most publishers ask for. 3× clears it, and
 * still lands well inside the clipboard's practical size.
 */
async function svgToPngBlob(svg: string, description: string, language: string, scale = 3): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
  });
  // A PNG has no alt attribute; its Description text is the one place a text alternative can travel.
  const bytes = withPngText(new Uint8Array(await png.arrayBuffer()), "Description", description, language);
  return new Blob([bytes], { type: "image/png" });
}

/** Download the grid as a heatmap image, mirroring the on-screen display options. */
export function HeatmapExports({
  authors,
  monoColor,
  showLevels,
  transpose,
  acronyms,
}: {
  authors: Author[];
  monoColor: string;
  showLevels: boolean;
  transpose: boolean;
  acronyms: boolean;
}) {
  const { translateRole, translateUi, outputLanguage } = useCreditTranslators();
  const t = useTranslations();
  const [loading, setLoading] = useState<ExportFormat | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, copy] = useCopyStatus({
    copied: t("annHeatmapCopied"),
  });

  const svgOptions = { transpose, monoColor, showLevels, acronyms, translateRole, translateUi, locale: outputLanguage };
  const renderSvg = () => buildHeatmapSvg(authors, svgOptions);
  const renderPng = () => svgToPngBlob(renderSvg(), heatmapDescription(authors, svgOptions), outputLanguage);

  function fail(format: ExportFormat) {
    const message = t("errHeatmapExport", { format: format.toUpperCase() });
    setError(message);
    announce(message, { assertive: true });
  }

  async function download(format: ExportFormat) {
    setLoading(format);
    setError(null);
    try {
      const svg = renderSvg();
      if (format === "svg") {
        downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "credit-heatmap.svg");
      } else {
        downloadBlob(await renderPng(), "credit-heatmap.png");
      }
    } catch {
      fail(format);
    } finally {
      setLoading(null);
    }
  }

  // Copy the image bytes (not a URL) so it pastes straight into a doc or slide,
  // the same move the CRediT badge makes. PNG, because that is what editors take.
  async function copyPng() {
    setLoading("copy");
    setError(null);
    try {
      // useCopyStatus owns the status, the announce and the 2s reset; this only
      // supplies the clipboard write and the inline error text.
      await copy(async () => {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": renderPng() })]);
      });
    } finally {
      setLoading(null);
    }
  }

  return (
    // One menu in the status strip: the heatmap is a figure you take out of
    // the app, so its three ways out sit together, away from the cells.
    <Popover>
      <PopoverTrigger className={TOOL_BUTTON}>
        <Download className="size-3.5" aria-hidden="true" />
        {t("heatmapLabel")}
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t("heatmapLabel")} className="grid w-56 gap-0.5 p-1">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => void copyPng()}
          title={t("copyHeatmapHint")}
          className={MENU_ITEM}
        >
          <Copy className="size-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
          {copyStatus === "copied" ? t("copied") : copyStatus === "error" ? t("copyFailedMessage") : t("copyPng")}
        </button>
        {(["svg", "png"] as ExportFormat[]).map((format) => (
          <button
            key={format}
            type="button"
            disabled={loading !== null}
            onClick={() => download(format)}
            className={MENU_ITEM}
          >
            <Download className="size-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
            {loading === format ? "…" : format === "svg" ? t("downloadSvg") : t("downloadPng")}
          </button>
        ))}
        {error && <p className="px-2 pt-1 pb-1.5 text-[11px] text-error">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
