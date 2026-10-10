"use client";

import { FileUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { Author, DoiLookupResult } from "@/core";
import {
  createAuthor,
  DOI_INPUT_REGEX,
  fromCsv,
  fromJats4rXml,
  fromJson,
  lookupDoiWork,
  MAX_AUTHORS,
  MAX_IMPORT_BYTES,
  normalizeDoi,
  parseAuthorText,
} from "@/core";
import { announce } from "@/lib/announce";
import { closeOnBackdrop, useModalDialog } from "@/lib/dialog";
import type { Messages } from "@/lib/intl";
import { MAX_DRAFTS } from "@/store/contribution-store";

/** Why a pasted share link could not be used, as a message key. */
export type LinkFailure = "errShareLinkBroken" | "mergeWrongDraft" | "mergeUnmatched" | "draftLimitReached";

interface Props {
  open: boolean;
  existingContributorCount: number;
  /** `title` is set only by the DOI path; the other importers carry no title. */
  onImport: (authors: Author[], title?: string) => void;
  /**
   * Handle a pasted share link. Returns a message key when it could not be
   * used, or null on success. Lives with the caller because merging a returned
   * link needs the current workspace, which this dialog does not hold.
   */
  onLink: (url: string) => Promise<LinkFailure | null>;
  onClose: () => void;
}

/** What a resolved import is waiting to write, once any replace is confirmed. */
interface PendingImport {
  authors: Author[];
  title?: string;
}

/**
 * Failure code → message key. Explicit rather than built by string
 * concatenation, so the typed-message guarantee still holds: a key removed from
 * en.json breaks the build here instead of silently rendering a key name.
 */
const DOI_ERROR_KEYS = {
  INVALID_DOI: "errDoiINVALID_DOI",
  NOT_FOUND: "errDoiNOT_FOUND",
  NO_AUTHORS: "errDoiNO_AUTHORS",
  TOO_MANY_AUTHORS: "errDoiTOO_MANY_AUTHORS",
  UNAVAILABLE: "errDoiUNAVAILABLE",
  OFFLINE: "errDoiOFFLINE",
} as const;

type DoiFailure = { code: keyof typeof DOI_ERROR_KEYS };

/**
 * Contact address for Crossref's "polite pool", which gets faster and more
 * reliable service than the anonymous pool. A public address, not a secret.
 */
const POLITE_MAILTO = "credit@duinlab.nl";

/** Look a DOI up straight from Crossref, which sends `Access-Control-Allow-Origin: *`. */
async function fetchDoiWork(doi: string): Promise<Extract<DoiLookupResult, { ok: true }> | DoiFailure> {
  if (!navigator.onLine) return { code: "OFFLINE" };
  const result = await lookupDoiWork(normalizeDoi(doi), fetch, POLITE_MAILTO);
  if (result.ok) return result;
  // A connection that drops mid-request fails as UNAVAILABLE; say offline.
  if (result.code === "UNAVAILABLE" && !navigator.onLine) return { code: "OFFLINE" };
  return { code: result.code };
}

type DetectedFormat = "link" | "csv" | "json" | "xml" | "names" | "unknown";

export function detect(text: string): DetectedFormat {
  const trimmed = text.trim();
  // A share link, most usefully one a co-author sent back with their own roles.
  if (/^https?:\/\/\S+#s=/.test(trimmed)) return "link";
  if (trimmed.startsWith("<")) return "xml";
  // JSON must be checked before the CSV heuristic: a toJson() payload contains
  // both a comma and a "name" field, so the CSV check would misclassify it.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* fall through */
    }
  }
  // CSV only with a "Name" header cell: a pasted "Anne Namer, Bob Smith" is names.
  const headerCells = (trimmed.split(/\r?\n/, 1)[0] ?? "").split(",");
  if (
    headerCells.some(
      (cell) =>
        cell
          .trim()
          .replace(/^"(.*)"$/, "$1")
          .trim()
          .toLowerCase() === "name",
    )
  ) {
    return "csv";
  }
  if (trimmed.length > 0) return "names";
  return "unknown";
}

/**
 * A JSON export stamped above version 1 comes from a newer build. Said
 * plainly, rather than as the validation failure it would otherwise be.
 */
export function madeByNewerVersion(json: string): boolean {
  const version = (JSON.parse(json) as { version?: unknown } | null)?.version;
  return typeof version === "number" && version > 1;
}

/** The import size cap, written the way the messages below say it. */
const MAX_IMPORT_MB = `${Math.round(MAX_IMPORT_BYTES / 1_000_000)} MB`;

/** Parser + "nothing found" message for each detectable format. */
const IMPORTERS: Record<
  Exclude<DetectedFormat, "unknown" | "link">,
  { parse: (text: string) => Author[]; emptyMessageKey: keyof Messages }
> = {
  json: { parse: fromJson, emptyMessageKey: "errImportNoJsonContributors" },
  csv: { parse: fromCsv, emptyMessageKey: "errImportNoCsvRows" },
  xml: { parse: fromJats4rXml, emptyMessageKey: "errImportNoXmlContribs" },
  names: { parse: parseAuthorText, emptyMessageKey: "errImportNoNames" },
};

/** Label shown beside the paste area; "JATS4R XML" and "CSV" are format names, not prose. */
const FORMAT_LABEL: Record<Exclude<DetectedFormat, "unknown">, (t: ReturnType<typeof useTranslations>) => string> = {
  names: (t) => t("importAuthorList"),
  link: (t) => t("formatShareLink"),
  json: (t) => t("formatJsonExport"),
  xml: () => "JATS4R XML",
  csv: () => "CSV",
};

export function ImportModal({ open, existingContributorCount, onImport, onLink, onClose }: Props) {
  const t = useTranslations();
  const [text, setText] = useState("");
  // Where the message belongs, not just what it says: a DOI failure shown at
  // the foot of a tall dialog is far from the field that caused it.
  const [error, setError] = useState<{ where: "doi" | "form"; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [doi, setDoi] = useState("");
  const [doiLoading, setDoiLoading] = useState(false);
  // State, not a ref, so useModalDialog re-runs once the element exists.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  // Bumped per lookup and on close: a result whose number is no longer current
  // belongs to a dialog the user has left, and must not import or confirm.
  const doiRequest = useRef(0);

  // The confirmation disables the Import button the user just activated, so
  // hand focus to the safe choice; declining hands it back once Import is
  // re-enabled (post-render, hence the effect). A confirm closes the dialog,
  // where onClose owns focus, so the dialog-open check skips that path.
  const hadPending = useRef(false);
  useEffect(() => {
    if (pending) {
      hadPending.current = true;
      keepRef.current?.focus();
      return;
    }
    if (!hadPending.current) return;
    hadPending.current = false;
    if (dialog?.open) importRef.current?.focus();
  }, [pending, dialog]);

  const format: DetectedFormat = detect(text);

  /** Show an import error and announce it (errors interrupt via role="alert"). */
  function showError(message: string, where: "doi" | "form" = "form") {
    setError({ where, message });
    announce(message, { assertive: true });
  }

  useModalDialog(dialog, open);

  async function handleFileRead(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      showError(t("errFileTooLarge", { limit: MAX_IMPORT_MB }));
      return;
    }
    try {
      setText(await file.text());
      setError(null);
    } catch {
      showError(t("errFileUnreadable"));
    }
  }

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileRead(file);
  }

  function handleFileDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileRead(file);
    // Reset so re-selecting the same file still fires a change event.
    e.target.value = "";
  }

  async function handleImport() {
    setError(null);
    if (format === "unknown") return;
    try {
      if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
        showError(t("errImportTooLarge", { limit: MAX_IMPORT_MB }));
        return;
      }
      if (format === "link") {
        // The whole-draft and merge cases both need the current workspace, so
        // the caller owns this one; failures come back as a message key.
        const failure = await onLink(text.trim());
        if (failure) {
          showError(failure === "draftLimitReached" ? t(failure, { count: MAX_DRAFTS }) : t(failure));
          return;
        }
        dialog?.close();
        return;
      }
      if (format === "json" && madeByNewerVersion(text)) {
        showError(t("errImportNewerVersion"));
        return;
      }
      const { parse, emptyMessageKey } = IMPORTERS[format];
      const authors = parse(text.trim());
      if (authors.length === 0) {
        showError(t(emptyMessageKey));
        return;
      }
      if (authors.length > MAX_AUTHORS) {
        showError(t("errTooManyContributors", { limit: MAX_AUTHORS }));
        return;
      }
      stageImport({ authors });
    } catch {
      showError(t("errImportFailed"));
    }
  }

  /** Import straight away, or hold it behind the replace confirmation. */
  function stageImport(next: PendingImport) {
    if (existingContributorCount > 0) {
      setPending(next);
      return;
    }
    finishImport(next);
  }

  async function handleDoiLookup() {
    setError(null);
    const trimmed = normalizeDoi(doi);
    if (!DOI_INPUT_REGEX.test(trimmed)) {
      showError(t("errDoiINVALID_DOI"), "doi");
      return;
    }
    const request = ++doiRequest.current;
    setDoiLoading(true);
    const result = await fetchDoiWork(trimmed);
    if (request !== doiRequest.current) return;
    setDoiLoading(false);
    if (!("ok" in result)) {
      showError(t(DOI_ERROR_KEYS[result.code]), "doi");
      return;
    }
    // Crossref names go through createAuthor like any other import, so the
    // initials and the empty role row are built exactly as they are for a
    // pasted list. Per entry, not around the whole map: one unusable entry
    // (a name Crossref sends but createAuthor rejects) costs that row, not
    // the other forty authors of the record.
    const authors = result.authors.flatMap((author) => {
      try {
        return [createAuthor(author.name, author.orcid ? { orcid: author.orcid } : undefined)];
      } catch {
        return [];
      }
    });
    if (authors.length === 0) {
      showError(t("errImportFailed"), "doi");
      return;
    }
    stageImport({ authors, title: result.title });
  }

  function finishImport({ authors, title }: PendingImport) {
    // `onImport` runs the authors back through the store's normalizeAuthors,
    // which throws on anything createAuthor cannot rebuild. On the confirm
    // path this sits outside handleImport's try, so an unguarded throw here
    // escaped the click handler instead of showing as an import error.
    try {
      onImport(authors, title);
    } catch {
      showError(t("errImportFailed"));
      return;
    }
    setPending(null);
    dialog?.close();
  }

  function handleClose() {
    doiRequest.current += 1;
    setDoiLoading(false);
    setText("");
    setDoi("");
    setError(null);
    setPending(null);
    onClose();
  }

  return (
    <dialog
      ref={setDialog}
      aria-labelledby="import-title"
      aria-describedby="import-description"
      onClose={handleClose}
      onMouseDown={closeOnBackdrop}
      className="relative m-auto w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden rounded-lg bg-surface-bright p-0 text-on-surface shadow-2xl ring-1 ring-outline-variant/20 backdrop:bg-on-surface/30 backdrop:backdrop-blur-sm"
    >
      <div>
        <div className="px-8 py-4 border-b border-outline-variant/10 bg-surface-container-low">
          <h2
            id="import-title"
            className="text-2xl italic font-semibold text-primary"
            style={{ fontFamily: "var(--font-headline)" }}
          >
            {t("importTitle")}
          </h2>
          <p id="import-description" className="text-sm text-on-surface-variant mt-1">
            {t("importDescription")}
          </p>
          <button
            type="button"
            onClick={() => dialog?.close()}
            className="absolute right-5 top-5 text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">{t("close")}</span>
          </button>
        </div>

        <div className="px-8 py-5 space-y-4">
          {/* DOI lookup */}
          <div>
            <label
              htmlFor="import-doi"
              className="block text-xs uppercase tracking-widest font-bold text-on-surface-variant mb-2"
            >
              {t("importFromDoi")}
            </label>
            <div className="flex gap-2">
              <input
                id="import-doi"
                type="text"
                inputMode="url"
                value={doi}
                onChange={(e) => {
                  setDoi(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // The same guard as the button's `disabled`, which Enter bypasses.
                    if (doiLoading || pending !== null) return;
                    void handleDoiLookup();
                  }
                }}
                placeholder={t("doiPlaceholder")}
                className="flex-1 min-w-0 bg-surface-container-low border-0 border-b-2 border-outline-variant/40 focus:border-primary focus:ring-0 outline-none text-sm font-mono px-4 py-2 text-on-surface rounded-t transition-colors"
              />
              <button
                type="button"
                onClick={() => void handleDoiLookup()}
                disabled={doiLoading || doi.trim().length === 0 || pending !== null}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-primary px-4 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-on-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-primary"
              >
                <Search className="h-4 w-4" />
                {doiLoading ? t("doiLookingUp") : t("doiLookUp")}
              </button>
            </div>
            {/* One slot for both, floored at the hint's two lines: swapping a
                one-line error in for the hint must not move the panels below. */}
            <p className={`mt-2 min-h-8 text-xs ${error?.where === "doi" ? "text-error" : "text-on-surface-variant"}`}>
              {error?.where === "doi" ? error.message : t("doiHint")}
            </p>
          </div>

          {/* Drop zone */}
          <div>
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant mb-2">
              {t("structuredFileUpload")}
            </p>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a mouse-only progressive enhancement; the Browse button + file input below provide the accessible path. */}
            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: same as above. */}
            <div
              onDragOver={handleFileDragOver}
              onDragLeave={() => setDragging(false)}
              onDrop={handleFileDrop}
              className={`border-2 border-dashed rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-3 transition-colors ${
                dragging ? "border-primary bg-surface-container" : "border-outline-variant/40 bg-surface"
              }`}
            >
              <div className="w-10 h-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                <FileUp className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface">{t("dragDropFile")}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{t("acceptedFileTypes")}</p>
              </div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="shrink-0 px-4 py-1.5 border border-primary text-primary text-xs font-semibold rounded hover:bg-primary hover:text-on-primary transition-colors"
              >
                {t("browseFiles")}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.json,.xml"
                className="hidden"
                onChange={handleFileInput}
                aria-label={t("a11yUploadFile")}
              />
            </div>
          </div>

          {/* Text area */}
          <div>
            <div className="flex justify-between items-end mb-2">
              <label
                htmlFor="import-text"
                className="block text-xs uppercase tracking-widest font-bold text-on-surface-variant"
              >
                {t("pasteRawData")}
              </label>
              {format !== "unknown" && (
                <span className="text-[11px] text-primary font-medium italic">
                  {t("detectedFormat", { format: FORMAT_LABEL[format](t) })}
                </span>
              )}
            </div>
            <textarea
              id="import-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              placeholder={t("importPlaceholder", { names: t("sampleNames") })}
              rows={6}
              className="w-full bg-surface-container-low border-0 border-b-2 border-outline-variant/40 focus:border-primary focus:ring-0 outline-none text-sm font-mono p-4 text-on-surface rounded-t resize-none transition-colors"
            />
          </div>

          {error?.where === "form" && (
            <p className="text-sm text-error bg-error-container/30 rounded px-4 py-2">{error.message}</p>
          )}

          {pending && (
            <div role="alert" className="rounded-lg bg-error-container/30 p-4 text-sm text-on-surface">
              <p className="font-semibold">{t("replaceWorkspaceTitle")}</p>
              <p className="mt-1 text-on-surface-variant">
                {t("replaceWorkspaceBody", {
                  incoming: pending.authors.length,
                  existing: existingContributorCount,
                })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  ref={keepRef}
                  type="button"
                  onClick={() => setPending(null)}
                  className="rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface-variant hover:border-primary hover:text-primary"
                >
                  {t("keepCurrentWork")}
                </button>
                <button
                  type="button"
                  onClick={() => finishImport(pending)}
                  className="rounded-lg bg-error px-4 py-2 font-semibold text-on-error hover:opacity-90"
                >
                  {t("replaceWorkspace")}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-8 py-3 border-t border-outline-variant/10 bg-surface-container-low flex justify-end gap-3">
          <button
            type="button"
            onClick={() => dialog?.close()}
            className="px-5 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            ref={importRef}
            type="button"
            onClick={() => void handleImport()}
            disabled={format === "unknown" || pending !== null}
            className="px-7 py-2 bg-primary text-on-primary text-sm font-bold rounded-lg shadow hover:bg-primary-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("importData")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
