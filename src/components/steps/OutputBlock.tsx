import { Check, Copy, Download } from "lucide-react";
import { type ReactNode, useId, useMemo } from "react";
import type { Contributor } from "@/core";
import {
  DATA_FORMATS,
  type DataExportOptions,
  type DataFormat,
  downloadDataExport,
  serializeDataExport,
} from "@/lib/data-exports";
import { useTranslations } from "@/lib/translations";
import { useCopyStatus } from "@/lib/use-copy-status";

export const EXPORT_ITEM_BUTTON =
  "flex min-h-7 max-sm:min-h-9 items-center gap-1 rounded px-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

type OutputProps = {
  authors: Contributor[];
  format: DataFormat;
  options?: DataExportOptions;
  language?: string;
};

function useExport({ authors, format, options }: OutputProps) {
  const t = useTranslations();
  const label = format === "ro-crate" ? t("exportRoCrateFragment") : DATA_FORMATS[format].label;
  const text = useMemo(
    () => (authors.length > 0 ? serializeDataExport(authors, format, options) : ""),
    [authors, format, options],
  );
  return { label, text };
}

function OutputButtons({
  format,
  label,
  labelId,
  text,
  disabled,
}: {
  format: DataFormat;
  label: string;
  labelId?: string;
  text: string;
  disabled: boolean;
}) {
  const t = useTranslations();
  const [status, copy] = useCopyStatus({ copied: t("annExportDataCopied") });
  return (
    <div className="flex items-center gap-1">
      <span id={labelId} className="min-w-0 flex-1">
        {label}
      </span>
      <button type="button" onClick={() => void copy(text)} disabled={disabled} className={EXPORT_ITEM_BUTTON}>
        {status === "copied" ? (
          <Check className="size-3.5 text-primary" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {status === "copied" ? t("copied") : status === "error" ? t("copyFailedMessage") : t("copy")}{" "}
        <span className="sr-only">{label}</span>
      </button>
      <button
        type="button"
        onClick={() => downloadDataExport(format, text)}
        disabled={disabled}
        aria-label={t("downloadFormat", { format: label })}
        title={t("downloadFormat", { format: label })}
        className={EXPORT_ITEM_BUTTON}
      >
        <Download className="size-3.5" aria-hidden="true" />
        {t("download")}
      </button>
    </div>
  );
}

export function OutputActions(props: OutputProps) {
  const { label, text } = useExport(props);
  return (
    <OutputButtons
      key={`${props.format}:${text}`}
      format={props.format}
      label={label}
      text={text}
      disabled={props.authors.length === 0}
    />
  );
}

export function OutputBlock({
  authors,
  format,
  options,
  language,
  children,
  rows = 4,
  labelledBy,
}: OutputProps & {
  children?: ReactNode;
  rows?: number;
  /** The id of visible text that names this output, read before the format's name. */
  labelledBy?: string;
}) {
  const { label, text } = useExport({ authors, format, options });
  const labelId = useId();
  return (
    <>
      <textarea
        aria-labelledby={labelledBy ? `${labelledBy} ${labelId}` : labelId}
        lang={language}
        readOnly
        value={text}
        rows={rows}
        spellCheck={false}
        className="w-full min-w-0 resize-y rounded border border-edge bg-surface-bright p-2 font-mono text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <ul>
        <li className="rounded-md py-0.5 pl-2 text-[13px] text-on-surface">
          <OutputButtons
            key={`${format}:${text}`}
            format={format}
            label={label}
            labelId={labelId}
            text={text}
            disabled={authors.length === 0}
          />
          {children}
        </li>
      </ul>
    </>
  );
}
