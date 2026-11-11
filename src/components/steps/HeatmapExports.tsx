import { ChevronDown, Copy, Download, Scan, Settings2, Shrink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type Author, heatmapDescription } from "@/core";
import { announce } from "@/lib/announce";
import { heatmapPrintSize, svgDimensions } from "@/lib/heatmap-print";
import { DEFAULT_HEATMAP_SETTINGS, type HeatmapOptions } from "@/lib/heatmap-settings";
import { withPngResolution, withPngText } from "@/lib/png-text";
import { useFormatter, useTranslations } from "@/lib/translations";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { download as downloadBlob } from "@/lib/utils";
import { useContributionStore } from "@/store/contribution-store";
import { MENU_ITEM, TOOL_BUTTON } from "./grid-shared";
import { HeatmapFigureSettings } from "./HeatmapFigureSettings";
import { HeatmapRecipe } from "./HeatmapRecipe";

type ExportFormat = "svg" | "png" | "pdf";

// One renderer keeps each loaded face; it fetches a face only when a figure's text first needs it.
let figureRenderer: Promise<import("@/core/figures").FigureRenderer> | undefined;
function renderer() {
  figureRenderer ??= import("@/core/figures")
    .then(({ createFigureRenderer }) => createFigureRenderer())
    .catch((error) => {
      figureRenderer = undefined;
      throw error;
    });
  return figureRenderer;
}

function pngDimensions(svg: string, widthMm: number, dpi: number) {
  const dimensions = svgDimensions(svg);
  const width = Math.round((widthMm / 25.4) * dpi);
  return { width, height: Math.round((width * dimensions.height) / dimensions.width) };
}

function glyphError(cause: unknown): string | null {
  return cause instanceof Error && cause.name === "FigureFontError" && "characters" in cause
    ? String(cause.characters)
    : null;
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
export function HeatmapExports({ authors, showLevels }: { authors: Author[]; showLevels: boolean }) {
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
  const monoColor = useContributionStore((s) => s.heatmapMonoColor);
  const colorByContributor = useContributionStore((s) => s.colorByContributor);
  const transpose = useContributionStore((s) => s.transpose);
  const initials = useContributionStore((s) => s.initials);
  // The grid and the figure share colour, orientation and initials; the stored figure settings hold the rest.
  const settings = useMemo<HeatmapOptions>(
    () => ({
      ...DEFAULT_HEATMAP_SETTINGS,
      // Untouched settings follow the grid's assignment mode.
      levels: showLevels,
      ...storedSettings,
      color: monoColor,
      colorBy: colorByContributor ? "contributor" : "color",
      horizontal: transpose,
      acronyms: initials,
    }),
    [storedSettings, showLevels, monoColor, colorByContributor, transpose, initials],
  );
  const [copyStatus, copy] = useCopyStatus({
    copied: t("annHeatmapCopied"),
  });

  const svgOptions = useMemo(
    () => ({
      ...settings,
      translateRole,
      translateUi,
      locale: outputLanguage,
    }),
    [settings, translateRole, translateUi, outputLanguage],
  );
  // SVG and PNG draw what the bundled faces lack in system fonts; only PDF needs every glyph embedded.
  const renderSvg = async () => (await renderer()).svg(authors, { ...svgOptions, fallback: "system" });
  const renderPng = async () =>
    svgToPngBlob(
      await renderSvg(),
      heatmapDescription(authors, svgOptions),
      outputLanguage,
      settings.pngWidthMm,
      settings.pngDpi,
    );
  const [{ preview, previewCause, missingGlyphs, rendering }, setPreview] = useState<{
    preview: string;
    previewCause: unknown;
    /** Characters the bundled faces lack: PDF is refused, SVG and PNG use system fonts for them. */
    missingGlyphs: string | null;
    rendering: boolean;
  }>({ preview: "", previewCause: null, missingGlyphs: null, rendering: true });
  useEffect(() => {
    if (!open) return;
    let active = true;
    setPreview((current) => ({ ...current, rendering: true }));
    (async () => {
      const figures = await renderer();
      try {
        return { preview: await figures.svg(authors, svgOptions), missingGlyphs: null };
      } catch (cause) {
        const missing = glyphError(cause);
        if (missing === null) throw cause;
        return { preview: await figures.svg(authors, { ...svgOptions, fallback: "system" }), missingGlyphs: missing };
      }
    })().then(
      (result) => {
        if (active) setPreview({ ...result, previewCause: null, rendering: false });
      },
      (cause: unknown) => {
        if (active) setPreview({ preview: "", previewCause: cause, missingGlyphs: null, rendering: false });
      },
    );
    return () => {
      active = false;
    };
  }, [open, authors, svgOptions]);
  const previewError = previewCause ? t("errHeatmapExport", { format: "SVG" }) : null;
  const dimensions = preview ? pngDimensions(preview, settings.pngWidthMm, settings.pngDpi) : null;
  const pngTooLarge = dimensions ? oversizedPng(dimensions) : false;
  const printFontSize = preview ? heatmapPrintSize(preview, settings.pngWidthMm).minFontPt : null;

  const currentCopyStatus =
    copySource?.svg === preview && copySource.widthMm === settings.pngWidthMm && copySource.dpi === settings.pngDpi
      ? copyStatus
      : "idle";

  function fail(format: ExportFormat, cause: unknown) {
    const missing = glyphError(cause);
    const message =
      missing === null
        ? t("errHeatmapExport", { format: format.toUpperCase() })
        : t("errFigureGlyphs", { characters: missing });
    setError(message);
    announce(message, { assertive: true });
  }

  async function download(format: ExportFormat) {
    setLoading(format);
    setError(null);
    try {
      if (format === "pdf") {
        downloadBlob(
          new Blob([new Uint8Array(await (await renderer()).pdf(authors, svgOptions, settings.pngWidthMm))], {
            type: "application/pdf",
          }),
          "credit-heatmap.pdf",
        );
      } else if (format === "svg") {
        downloadBlob(new Blob([await renderSvg()], { type: "image/svg+xml;charset=utf-8" }), "credit-heatmap.svg");
      } else {
        downloadBlob(await renderPng(), "credit-heatmap.png");
      }
    } catch (cause) {
      fail(format, cause);
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
        aria-busy={rendering && !preview}
        className={`grid max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto p-3 ${settingsOpen ? "w-[48rem]" : "w-[32rem]"}`}
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
              disabled={!preview || !!previewError}
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
              SVG · PDF · PNG {dimensions.width} × {dimensions.height} px · {settings.pngDpi} dpi
            </span>
          )}
          {settings.colorBy === "contributor" && (
            <p className="w-full text-xs text-on-surface-variant">{t("heatmapPerContributorNote")}</p>
          )}
          {printFontSize !== null && printFontSize < 6 && (
            <p className="w-full text-xs text-on-surface-variant">
              {t("heatmapSmallPrint", { size: formatter.number(printFontSize, { maximumFractionDigits: 1 }) })}
            </p>
          )}
        </div>
        {rendering && !preview && (
          <p role="status" className="text-sm text-on-surface-variant">
            …
          </p>
        )}
        <div>
          <div className={`grid min-w-0 gap-3 ${settingsOpen ? "sm:grid-cols-[minmax(0,1fr)_15rem]" : ""}`}>
            {preview && (
              <section
                lang={outputLanguage}
                aria-label={translateUi("heatmapTitle")}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: the figure scrolls and keyboard users need to reach it.
                tabIndex={0}
                // self-start: beside the taller settings column the frame would stretch and float the figure in white.
                className={`min-h-24 max-h-[min(50vh,24rem)] overflow-auto rounded bg-surface-container p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:sticky sm:top-0 sm:self-start ${settingsOpen ? "hidden sm:block" : ""}`}
              >
                <img
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.toWellFormed())}`}
                  alt={heatmapDescription(authors, svgOptions)}
                  // The white is the figure's own page on a tinted desk, so its edges show the export's crop.
                  // Fitted, the whole page shows inside the frame (its height less the p-3 padding);
                  // Actual size scrolls instead.
                  className={`mx-auto block bg-white shadow-card ${actualSize ? "h-auto max-w-none" : "h-auto max-h-[calc(min(50vh,24rem)-1.5rem)] w-auto max-w-full"}`}
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
                {/* On a phone the settings replace the preview, so give a visible way back to it. */}
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className={`${TOOL_BUTTON} mt-3 min-h-11 w-full justify-center sm:hidden`}
                >
                  {t("statementBack")}
                </button>
              </section>
            )}
          </div>
        </div>
        <div className="grid gap-0.5 sm:grid-cols-4">
          <button
            type="button"
            disabled={!preview || loading !== null || !!previewError || pngTooLarge}
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
          {(["svg", "pdf", "png"] as ExportFormat[]).map((format) => (
            <button
              key={format}
              type="button"
              disabled={
                !preview ||
                loading !== null ||
                !!previewError ||
                (format === "png" && pngTooLarge) ||
                (format === "pdf" && missingGlyphs !== null)
              }
              onClick={() => download(format)}
              className={MENU_ITEM}
            >
              <Download className="size-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
              {loading === format
                ? "…"
                : format === "svg"
                  ? t("downloadSvg")
                  : format === "pdf"
                    ? t("downloadPdf")
                    : t("downloadPng")}
            </button>
          ))}
        </div>
        {pngTooLarge && (
          <p role="status" className="text-xs text-on-surface-variant">
            {t("heatmapPngTooLarge")}
          </p>
        )}
        {missingGlyphs !== null && (
          <p role="status" className="px-2 text-xs text-on-surface-variant">
            {t("errFigureGlyphs", { characters: missingGlyphs })} {t("heatmapSystemFonts")}
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
