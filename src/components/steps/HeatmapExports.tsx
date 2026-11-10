import { ChevronDown, Copy, Download, Scan, Settings2, Shrink } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type Author, buildHeatmapSvg, heatmapDescription } from "@/core";
import { announce } from "@/lib/announce";
import { heatmapPrintSize, svgDimensions } from "@/lib/heatmap-print";
import { DEFAULT_HEATMAP_SETTINGS } from "@/lib/heatmap-settings";
import { withPngResolution, withPngText } from "@/lib/png-text";
import { useFormatter, useTranslations } from "@/lib/translations";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { download as downloadBlob } from "@/lib/utils";
import { useContributionStore } from "@/store/contribution-store";
import { MENU_ITEM, TOOL_BUTTON } from "./grid-shared";
import { HeatmapFigureSettings } from "./HeatmapFigureSettings";
import { HeatmapRecipe } from "./HeatmapRecipe";

type ExportFormat = "svg" | "png";

function pngDimensions(svg: string, widthMm: number, dpi: number) {
  const dimensions = svgDimensions(svg);
  const width = Math.round((widthMm / 25.4) * dpi);
  return { width, height: Math.round((width * dimensions.height) / dimensions.width) };
}

function oversizedPng({ width, height }: { width: number; height: number }) {
  return width > 16384 || height > 16384 || width * height > 32_000_000;
}

/** Rasterise locally at the requested physical size, retaining print density and text alternative. */
async function svgToPngBlob(
  svg: string,
  description: string,
  language: string,
  widthMm: number,
  dpi: number,
): Promise<Blob> {
  const pixels = pngDimensions(svg, widthMm, dpi);
  if (oversizedPng(pixels)) throw new RangeError("PNG dimensions exceed the canvas limit.");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, pixels.width, pixels.height);
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
  });
  // A PNG has no alt attribute; its Description text is the one place a text alternative can travel.
  const bytes = withPngResolution(
    withPngText(new Uint8Array(await png.arrayBuffer()), "Description", description, language),
    dpi,
  );
  return new Blob([bytes], { type: "image/png" });
}

/** Preview, configure and download one draft's contribution figure. */
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
  const formatter = useFormatter();
  const [loading, setLoading] = useState<ExportFormat | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copySource, setCopySource] = useState<{ svg: string; widthMm: number; dpi: number } | null>(null);
  const storedSettings = useContributionStore((s) => s.heatmapSettings);
  const setSettings = useContributionStore((s) => s.setHeatmapSettings);
  const settings = storedSettings ?? {
    ...DEFAULT_HEATMAP_SETTINGS,
    color: monoColor,
    levels: showLevels,
    horizontal: transpose,
    acronyms,
  };
  const [copyStatus, copy] = useCopyStatus({
    copied: t("annHeatmapCopied"),
  });

  const svgOptions = {
    ...settings,
    translateRole,
    translateUi,
    locale: outputLanguage,
  };
  const renderSvg = () => buildHeatmapSvg(authors, svgOptions);
  const renderPng = () =>
    svgToPngBlob(
      renderSvg(),
      heatmapDescription(authors, svgOptions),
      outputLanguage,
      settings.pngWidthMm,
      settings.pngDpi,
    );
  let preview = "";
  let previewError: string | null = null;
  try {
    if (open) preview = renderSvg();
  } catch {
    previewError = t("errHeatmapExport", { format: "SVG" });
  }
  const dimensions = preview ? pngDimensions(preview, settings.pngWidthMm, settings.pngDpi) : null;
  const pngTooLarge = dimensions ? oversizedPng(dimensions) : false;
  const printFontSize = preview ? heatmapPrintSize(preview, settings.pngWidthMm).minFontPt : null;
  const currentCopyStatus =
    copySource?.svg === preview && copySource.widthMm === settings.pngWidthMm && copySource.dpi === settings.pngDpi
      ? copyStatus
      : "idle";

  function fail(format: ExportFormat) {
    const message = t("errHeatmapExport", { format: format.toUpperCase() });
    setError(message);
    announce(message, { assertive: true });
  }

  async function download(format: ExportFormat) {
    setLoading(format);
    setError(null);
    try {
      if (format === "svg") {
        downloadBlob(new Blob([renderSvg()], { type: "image/svg+xml;charset=utf-8" }), "credit-heatmap.svg");
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
      await copy(async () => {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": renderPng() })]);
      });
      setCopySource({ svg: preview, widthMm: settings.pngWidthMm, dpi: settings.pngDpi });
    } finally {
      setLoading(null);
    }
  }

  return (
    // One menu in the status strip: the heatmap is a figure you take out of
    // the app, so its three ways out sit together, away from the cells.
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={TOOL_BUTTON}>
        <Download className="size-3.5" aria-hidden="true" />
        {t("heatmapLabel")}
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        aria-label={t("heatmapLabel")}
        className={`grid max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-y-auto p-3 ${settingsOpen ? "w-[48rem]" : "w-[32rem]"}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p lang={outputLanguage} className="text-sm font-semibold text-on-surface">
            {translateUi("heatmapTitle")}
          </p>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="heatmap-figure-settings"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`${TOOL_BUTTON} min-h-8 px-2`}
            >
              <Settings2 className="size-3.5" aria-hidden="true" />
              {t("heatmapFigureSettings")}
            </button>
            <button
              type="button"
              disabled={!!previewError}
              onClick={() => setActualSize(!actualSize)}
              className={`${TOOL_BUTTON} min-h-8 px-2`}
            >
              {actualSize ? (
                <Shrink className="size-3.5" aria-hidden="true" />
              ) : (
                <Scan className="size-3.5" aria-hidden="true" />
              )}
              {actualSize ? t("heatmapFitWidth") : t("heatmapActualSize")}
            </button>
          </div>
          {dimensions && (
            <span className="w-full text-xs tabular-nums text-on-surface-variant">
              SVG · PNG {dimensions.width} × {dimensions.height} px · {settings.pngDpi} dpi
            </span>
          )}
          {printFontSize !== null && printFontSize < 6 && (
            <p className="w-full text-xs text-on-surface-variant">
              {t("heatmapSmallPrint", { size: formatter.number(printFontSize, { maximumFractionDigits: 1 }) })}
            </p>
          )}
        </div>
        <div className="min-h-0 overflow-auto">
          <div className={`grid min-w-0 gap-3 ${settingsOpen ? "sm:grid-cols-[minmax(0,1fr)_15rem]" : ""}`}>
            {preview && (
              <section
                lang={outputLanguage}
                aria-label={translateUi("heatmapTitle")}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: the figure scrolls and keyboard users need to reach it.
                tabIndex={0}
                className={`min-h-24 max-h-[min(50vh,24rem)] overflow-auto rounded border border-outline-variant bg-white p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:sticky sm:top-0 ${settingsOpen ? "hidden sm:block" : ""}`}
              >
                <img
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.toWellFormed())}`}
                  alt={heatmapDescription(authors, svgOptions)}
                  className={`mx-auto block h-auto ${actualSize ? "max-w-none" : "max-w-full"}`}
                />
              </section>
            )}
            {settingsOpen && (
              <section
                id="heatmap-figure-settings"
                aria-label={t("heatmapFigureSettings")}
                className="min-w-0 sm:max-h-[min(50vh,24rem)] sm:overflow-auto sm:pr-1"
              >
                <HeatmapFigureSettings
                  value={settings}
                  onChange={(value) => {
                    setError(null);
                    setSettings(value);
                  }}
                />
                <HeatmapRecipe settings={settings} language={outputLanguage} />
              </section>
            )}
          </div>
        </div>
        <div className="grid gap-0.5 sm:grid-cols-3">
          <button
            type="button"
            disabled={loading !== null || !!previewError || pngTooLarge}
            onClick={() => void copyPng()}
            title={t("copyHeatmapHint")}
            className={MENU_ITEM}
          >
            <Copy className="size-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
            {currentCopyStatus === "copied"
              ? t("copied")
              : currentCopyStatus === "error"
                ? t("copyFailedMessage")
                : t("copyPng")}
          </button>
          {(["svg", "png"] as ExportFormat[]).map((format) => (
            <button
              key={format}
              type="button"
              disabled={loading !== null || !!previewError || (format === "png" && pngTooLarge)}
              onClick={() => download(format)}
              className={MENU_ITEM}
            >
              <Download className="size-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
              {loading === format ? "…" : format === "svg" ? t("downloadSvg") : t("downloadPng")}
            </button>
          ))}
        </div>
        {pngTooLarge && (
          <p role="status" className="text-xs text-on-surface-variant">
            {t("heatmapPngTooLarge")}
          </p>
        )}
        {(error || previewError) && (
          <p role="alert" className="px-2 text-xs text-error">
            {error || previewError}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
