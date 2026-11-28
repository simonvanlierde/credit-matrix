import { useId } from "react";
import { selectFigureFont, useCustomFigureFont } from "@/lib/custom-figure-font";
import { useTranslations } from "@/lib/translations";
import { TOOL_BUTTON } from "./grid-shared";

export function CustomFigureFont() {
  const t = useTranslations();
  const id = useId();
  const { font, busy, ready, error, detail } = useCustomFigureFont();
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className="text-on-surface-variant">
        {t("heatmapCustomFont")}
      </label>
      <input
        id={id}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        disabled={busy || !ready}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void selectFigureFont(file);
          event.currentTarget.value = "";
        }}
        className="min-h-9 w-full min-w-0 text-xs file:mr-2 file:min-h-9 file:rounded file:border-0 file:bg-surface-container file:px-2 file:text-on-surface hover:file:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <p id={`${id}-hint`} className="text-on-surface-variant">
        {t("heatmapCustomFontHint")}
      </p>
      {font && (
        <>
          <p className="break-words text-on-surface-variant">{t("heatmapCustomFontActive", { family: font.family })}</p>
          <button
            type="button"
            className={`${TOOL_BUTTON} w-fit`}
            disabled={busy || !ready}
            onClick={() => void selectFigureFont(null)}
          >
            {t("heatmapCustomFontRemove")}
          </button>
          {font.warning && (
            <p role="status" className="text-on-surface-variant">
              {font.warning}
            </p>
          )}
        </>
      )}
      {busy && <p role="status">{t("heatmapCustomFontLoading")}</p>}
      {error && (
        <p role="alert" className="text-error">
          {t(error === "font" ? "heatmapCustomFontInvalid" : "heatmapCustomFontStorageError")} {detail}
        </p>
      )}
    </div>
  );
}
