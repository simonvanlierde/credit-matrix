"use client";

import { CircleAlert, FileUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import {
  type Ask,
  type Author,
  type CreditRoleName,
  createAuthor,
  type DetectedFormat,
  detectFormat,
  importAny,
  MAX_STATEMENT_LENGTH,
  NewerVersionError,
  namesCredit,
  parseStatement,
  statementAuthor,
} from "@/core";
import { recheckSignIns } from "@/core/ask";
import { MAX_AUTHORS, MAX_IMPORT_BYTES, scoreToLevel } from "@/core/author";
import type { DoiLookupResult } from "@/core/lookup";
import { DOI_INPUT_REGEX, lookupDoiWork, normalizeDoi } from "@/core/lookup";
import { fetchOrcidKeys } from "@/core/orcid-proof";
import { announce } from "@/lib/announce";
import { closeOnBackdrop, useModalDialog } from "@/lib/dialog";
import type { Messages } from "@/lib/intl";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { MAX_DRAFTS } from "@/store/contribution-store";
import { ASSIGNABLE_LEVELS, DEFAULT_BULK_LEVEL } from "./steps/BulkAssignMenu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/** Why a pasted share link could not be used, as a message key. */
export type LinkFailure = "errShareLinkBroken" | "mergeWrongDraft" | "mergeUnmatched" | "draftLimitReached";

interface Props {
  open: boolean;
  existingContributorCount: number;
  onImport: (next: PendingImport) => void;
  /**
   * Handle a pasted share link. Returns a message key when it could not be
   * used, or null on success. Lives with the caller because merging a returned
   * link needs the current workspace, which this dialog does not hold.
   */
  onLink: (url: string) => Promise<LinkFailure | null>;
  /** The open draft's roster, which a pasted statement is matched against. */
  authors: Author[];
  /** Whether the draft records levels; a yes/no draft sets every role to 100. */
  graded: boolean;
  /**
   * Write the roster with a pasted statement's roles added; `added` counts the new roles, and
   * `level` names the level they got in a graded draft.
   */
  onApplyStatement: (authors: Author[], added: number, level?: string) => void;
  onClose: () => void;
}

/** A pasted statement read against the open draft, waiting for Apply. */
interface StatementReview {
  /** Per contributor, the roles the statement gives them; `set` ones the grid already has. */
  rows: { id: string; name: string; roles: { role: CreditRoleName; set: boolean }[] }[];
  /** Names or initials that fit no contributor, or several, with the roles left out. */
  unmatched: { token: string; candidates: string[]; roles: CreditRoleName[] }[];
  /** Roles the roster does not have yet. Ones already set are left as they are. */
  added: number;
  /** Contributors who gain at least one role. */
  people: number;
}

// A line that ends on one of these runs on into the next: "Conceptualization, A.B.,\nC.D.".
const RUNS_ON_RE = /(?:[,:&‐-―−-]|(?<!\p{L})and)$/iu;

/**
 * A line break as the end of a clause, as most statements laid out one person per line mean it:
 * "A.B. - conceptualization\nC.D. - software". The shared parser reads it as a space, as the
 * census does, so this applies to pasted text only.
 */
function breakLines(text: string): string {
  let joined = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    joined = joined ? `${joined}${RUNS_ON_RE.test(joined) ? " " : "; "}${trimmed}` : trimmed;
  }
  return joined;
}

/** Read a prepared statement against the roster. */
function reviewStatement(text: string, authors: Author[]): StatementReview {
  const { assignments, unmatched } = parseStatement(text, authors.map(statementAuthor));
  const rows = authors.map((author, i) => {
    const set = new Set(author.contributions.filter((c) => c.score > 0).map((c) => c.role));
    return {
      id: author.id,
      name: author.name,
      roles: assignments.filter((a) => a.author === i).map(({ role }) => ({ role, set: set.has(role) })),
    };
  });
  const gaining = rows.filter((row) => row.roles.some((r) => !r.set));
  return {
    rows,
    unmatched: unmatched.map((u) => ({ ...u, candidates: u.candidates.map((i) => authors[i]?.name ?? "") })),
    added: gaining.reduce((sum, row) => sum + row.roles.filter((r) => !r.set).length, 0),
    people: gaining.length,
  };
}

/**
 * The roster with the reviewed roles set to `score`, matched by contributor id. A role already
 * set keeps its level, and a contributor the review does not know is left alone.
 */
function withStatementRoles(authors: Author[], review: StatementReview, score: number): [Author[], number] {
  const byId = new Map(review.rows.map((row) => [row.id, new Set(row.roles.map((r) => r.role))]));
  let added = 0;
  const next = authors.map((author) => {
    const roles = byId.get(author.id);
    if (!roles) return author;
    return {
      ...author,
      contributions: author.contributions.map((c) => {
        if (!roles.has(c.role) || c.score > 0) return c;
        added += 1;
        return { ...c, score };
      }),
    };
  });
  return [next, added];
}

/** What a resolved import is waiting to write, once any replace is confirmed. */
export interface PendingImport {
  authors: Author[];
  /** Set only by the DOI path; the other importers carry no title. */
  title?: string;
  /** Co-author asks and answers, from a JSON export that has them. */
  asks?: Record<string, Ask>;
  /** The contributor who made a JSON export, under the file's own id. */
  selfId?: string;
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

/** The import size cap, written the way the messages below say it. */
const MAX_IMPORT_MB = `${Math.round(MAX_IMPORT_BYTES / 1_000_000)} MB`;

/** The "nothing found" message for each importable format. */
const EMPTY_MESSAGE_KEYS: Record<Exclude<DetectedFormat, "unknown" | "link" | "statement">, keyof Messages> = {
  json: "errImportNoJsonContributors",
  csv: "errImportNoCsvRows",
  tenzing: "errImportNoCsvRows",
  xml: "errImportNoXmlContribs",
  names: "errImportNoNames",
};

/** Label shown beside the paste area; "JATS4R XML" and "CSV" are format names, not prose. */
const FORMAT_LABEL: Record<Exclude<DetectedFormat, "unknown">, (t: ReturnType<typeof useTranslations>) => string> = {
  names: (t) => t("importAuthorList"),
  link: (t) => t("formatShareLink"),
  json: (t) => t("formatJsonExport"),
  statement: (t) => t("formatStatement"),
  xml: () => "JATS4R XML",
  csv: () => "CSV",
  tenzing: () => "tenzing",
};

export function ImportModal({
  open,
  existingContributorCount,
  authors: draftAuthors,
  graded,
  onImport,
  onLink,
  onApplyStatement,
  onClose,
}: Props) {
  const t = useTranslations();
  const { translateInterfaceRole, translateInterfaceUi } = useCreditTranslators();
  const formatter = useFormatter();
  const [text, setText] = useState("");
  const [review, setReview] = useState<StatementReview | null>(null);
  const [statementLevel, setStatementLevel] = useState(String(DEFAULT_BULK_LEVEL));
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  // Back hides the review and brings the footer's button back: focus goes there, not to the page.
  const backedOut = useRef(false);
  // Where the message belongs, not just what it says: a DOI failure shown at
  // the foot of a tall dialog is far from the field that caused it.
  const [error, setError] = useState<{ where: "doi" | "form"; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [doi, setDoi] = useState("");
  const [doiLoading, setDoiLoading] = useState(false);
  // A second click during the await would run the import again: for a share
  // link, the first fills the empty workspace and the second opens a duplicate.
  const [importing, setImporting] = useState(false);
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

  // The review replaces the paste area's footer action, so its heading takes
  // focus and a screen reader starts at the summary.
  useEffect(() => {
    if (review) reviewHeadingRef.current?.focus();
    else if (backedOut.current) {
      backedOut.current = false;
      importRef.current?.focus();
    }
  }, [review]);

  const format = detectFormat(text);

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
      setFileName(file.name);
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

  // A file dropped outside the zone would make the browser open it and lose the draft.
  function swallowDrag(e: React.DragEvent<HTMLDialogElement>) {
    e.preventDefault();
  }

  function handleFileDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // dragleave also fires when the pointer moves onto a child of the zone.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
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
    setImporting(true);
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
      if (format === "statement") {
        const statement = breakLines(text);
        if (statement.length > MAX_STATEMENT_LENGTH) {
          showError(t("errStatementTooLong", { limit: formatter.number(MAX_STATEMENT_LENGTH) }));
          return;
        }
        // Matched against the draft as it is now: a statement names no one the draft lacks.
        if (draftAuthors.length === 0) {
          showError(t("errStatementNoContributors"));
          return;
        }
        const found = reviewStatement(statement, draftAuthors);
        if (found.rows.every((row) => row.roles.length === 0)) {
          // Prose ("A.B. wrote the paper") lands here too: say what the reader looks for.
          showError(
            namesCredit(statement)
              ? t("errStatementNoRoles")
              : `${t("errStatementNoRoles")} ${t("statementOnlyCredit")}`,
          );
          return;
        }
        setReview(found);
        return;
      }
      const parsed = await importAny(text);
      const { authors } = parsed;
      if (authors.length === 0) {
        showError(t(EMPTY_MESSAGE_KEYS[format]));
        return;
      }
      if (authors.length > MAX_AUTHORS) {
        showError(t("errTooManyContributors", { limit: MAX_AUTHORS }));
        return;
      }
      // A file's ORCID sign-ins are only claims until checked against ORCID's keys.
      if (parsed.asks) parsed.asks = await recheckSignIns(parsed.asks, () => fetchOrcidKeys());
      stageImport(parsed);
    } catch (failure) {
      // A newer build's export is said plainly, not as a validation failure.
      showError(t(failure instanceof NewerVersionError ? "errImportNewerVersion" : "errImportFailed"));
    } finally {
      setImporting(false);
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

  function finishImport(next: PendingImport) {
    // `onImport` runs the authors back through the store's normalizeRoster,
    // which throws on anything createAuthor cannot rebuild. On the confirm
    // path this sits outside handleImport's try, so an unguarded throw here
    // escaped the click handler instead of showing as an import error.
    try {
      onImport(next);
    } catch {
      showError(t("errImportFailed"));
      return;
    }
    setPending(null);
    dialog?.close();
  }

  function applyStatement(found: StatementReview) {
    const score = graded ? Number(statementLevel) : 100;
    const [next, added] = withStatementRoles(draftAuthors, found, score);
    try {
      onApplyStatement(next, added, graded ? translateInterfaceUi(scoreToLevel(score)) : undefined);
    } catch {
      showError(t("errImportFailed"));
      return;
    }
    setReview(null);
    dialog?.close();
  }

  function handleClose() {
    doiRequest.current += 1;
    setDoiLoading(false);
    setText("");
    setDoi("");
    setFileName(null);
    setError(null);
    setPending(null);
    setReview(null);
    onClose();
  }

  return (
    <dialog
      ref={setDialog}
      aria-labelledby="import-title"
      aria-describedby="import-description"
      onClose={handleClose}
      onMouseDown={closeOnBackdrop}
      onDragOver={swallowDrag}
      onDrop={swallowDrag}
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
                aria-describedby="import-doi-note"
                aria-invalid={error?.where === "doi" || undefined}
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
            <p
              id="import-doi-note"
              className={`mt-2 min-h-8 text-xs ${error?.where === "doi" ? "text-error" : "text-on-surface-variant"}`}
            >
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
              onDragLeave={handleFileDragLeave}
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
                accept=".csv,.tsv,.json,.xml"
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
              {fileName && (
                <span className="text-[11px] text-on-surface-variant italic">
                  {t("fileLoaded", { name: fileName })}
                </span>
              )}
              {format !== "unknown" && (
                <span className="text-[11px] text-primary font-medium italic">
                  {t("detectedFormat", { format: FORMAT_LABEL[format](t) })}
                </span>
              )}
            </div>
            <textarea
              id="import-text"
              value={text}
              aria-describedby={error?.where === "form" ? "import-form-error" : undefined}
              aria-invalid={error?.where === "form" || undefined}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
                setError(null);
                setReview(null);
              }}
              placeholder={t("importPlaceholder", { names: t("sampleNames") })}
              rows={6}
              className="w-full bg-surface-container-low border-0 border-b-2 border-outline-variant/40 focus:border-primary focus:ring-0 outline-none text-sm font-mono p-4 text-on-surface rounded-t resize-none transition-colors"
            />
          </div>

          {error?.where === "form" && (
            <p id="import-form-error" className="text-sm text-error bg-error-container/30 rounded px-4 py-2">
              {error.message}
            </p>
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

          {review && (
            <section
              aria-labelledby="statement-review-title"
              className="rounded-lg bg-surface-container-low p-4 text-sm"
            >
              <h3
                id="statement-review-title"
                ref={reviewHeadingRef}
                tabIndex={-1}
                aria-describedby="statement-review-summary"
                className="text-lg font-semibold text-primary outline-none"
                style={{ fontFamily: "var(--font-headline)" }}
              >
                {t("statementReviewTitle")}
              </h3>
              <p id="statement-review-summary" className="mt-1 text-on-surface-variant">
                {review.added === 0
                  ? t("statementNothingNew")
                  : graded
                    ? t("statementReviewSummaryLevel", {
                        added: review.added,
                        people: review.people,
                        level: translateInterfaceUi(scoreToLevel(Number(statementLevel))),
                      })
                    : t("statementReviewSummary", { added: review.added, people: review.people })}
              </p>
              {graded && review.added > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span id="statement-level" className="font-semibold text-on-surface">
                    {t("bulkAssignLevel")}
                  </span>
                  <Select value={statementLevel} onValueChange={setStatementLevel}>
                    <SelectTrigger className="w-40" aria-labelledby="statement-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE_LEVELS.map(({ key, score }) => (
                        <SelectItem key={key} value={String(score)}>
                          {translateInterfaceUi(key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <ul className="mt-3 divide-y divide-outline-variant/30 border-y border-outline-variant/30">
                {review.rows.map((row) => (
                  <li key={row.id} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
                    <span className="font-medium break-words text-on-surface">{row.name}</span>
                    {row.roles.length > 0 ? (
                      // Commas only: an "and" would read as part of "Review and editing".
                      <span className="text-on-surface">
                        {row.roles.map(({ role, set }, i) => (
                          <span key={role}>
                            {i > 0 && ", "}
                            {set ? (
                              <span className="text-on-surface-variant">
                                {t("statementRoleAlreadySet", { role: translateInterfaceRole(role) })}
                              </span>
                            ) : (
                              translateInterfaceRole(role)
                            )}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="italic text-on-surface-variant">{t("statementNoRoles")}</span>
                    )}
                  </li>
                ))}
              </ul>
              {review.unmatched.length > 0 && (
                <div className="mt-3 flex gap-2 text-on-surface">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-on-surface-variant" />
                  <div className="min-w-0">
                    <p className="font-semibold">{t("statementUnmatchedTitle")}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {review.unmatched.map(({ token, candidates, roles }) => {
                        const who =
                          candidates.length > 1
                            ? t("statementUnmatchedAmbiguous", {
                                token,
                                names: formatter.list(candidates, { type: "disjunction" }),
                              })
                            : t("statementUnmatchedNone", { token });
                        return (
                          <li key={token} className="break-words">
                            {roles.length > 0
                              ? t("statementLeftOut", { who, roles: roles.map(translateInterfaceRole).join(", ") })
                              : who}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-1 text-on-surface-variant">{t("statementUnresolvedBody")}</p>
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    backedOut.current = true;
                    setReview(null);
                  }}
                  className="rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface-variant hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t("statementBack")}
                </button>
                <button
                  type="button"
                  onClick={() => applyStatement(review)}
                  disabled={review.added === 0}
                  className="rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("statementApply")}
                </button>
              </div>
            </section>
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
          {/* The review carries its own Apply; a faded twin here would only compete with it. */}
          {!review && (
            <button
              ref={importRef}
              type="button"
              onClick={() => void handleImport()}
              disabled={format === "unknown" || pending !== null || importing}
              className="px-7 py-2 bg-primary text-on-primary text-sm font-bold rounded-lg shadow hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {format === "statement" ? t("statementReview") : t("importData")}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
