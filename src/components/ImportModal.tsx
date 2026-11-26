import { Check, ChevronDown, CircleAlert, FileUp, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Ask,
  type Contributor,
  CREDIT_ROLES,
  type CreditRoleName,
  createAuthor,
  type DetectedFormat,
  detectFormat,
  ExportOnlyError,
  importAny,
  MAX_STATEMENT_LENGTH,
  NewerVersionError,
  namesCredit,
  parseStatement,
  RepeatedIdError,
  ScoreCellError,
  statementAuthor,
  type Toolchain,
  XmlParseError,
} from "@/core";
import { recheckSignIns } from "@/core/ask";
import { MAX_AUTHORS, MAX_IMPORT_BYTES, scoreToLevel } from "@/core/author";
import { UNKNOWN_TOOLCHAIN_WARNING } from "@/core/export/json";
import type { DoiLookupResult } from "@/core/lookup";
import { DOI_INPUT_REGEX, lookupDoiWork, normalizeDoi } from "@/core/lookup";
import { newContributors } from "@/core/merge-row";
import { fetchOrcidKeys } from "@/core/orcid-proof";
import { announce } from "@/lib/announce";
import { ConverterUnavailableError, convertCitation } from "@/lib/citation-import";
import { closeOnBackdrop, useModalDialog } from "@/lib/dialog";
import { type AuthorReading, combine, MODEL_BYTES, type ReaderResult, type ReadRole } from "@/lib/statement-reader";
import { useFormatter, useTranslations } from "@/lib/translations";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useStatementReading } from "@/lib/use-statement-reading";
import type { MessageKey } from "@/locales/keys";
import { MAX_DRAFTS } from "@/store/contribution-store";
import { ASSIGNABLE_LEVELS, DEFAULT_BULK_LEVEL } from "./steps/BulkAssignMenu";
import { ExternalLink } from "./ui/external-link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/** Why a pasted share link could not be used, as a message key. */
export type LinkFailure = "errShareLinkBroken" | "mergeWrongDraft" | "mergeUnmatched" | "draftLimitReached";

interface Props {
  open: boolean;
  existingContributorCount: number;
  /** `add` keeps the draft and appends the contributors it lacks; `replace` swaps the roster. */
  onImport: (next: PendingImport, mode: ImportMode) => void;
  /**
   * Handle a pasted share link. Returns a message key when it could not be
   * used, or null on success. Lives with the caller because merging a returned
   * link needs the current workspace, which this dialog does not hold.
   */
  /** `current` turns false once the dialog closes: a link that finishes loading after that must not open. */
  onLink: (url: string, current: () => boolean) => Promise<LinkFailure | null>;
  /** The open draft's roster, which a pasted statement is matched against. */
  authors: Contributor[];
  /** Whether the draft records levels; a yes/no draft sets every role to 100. */
  graded: boolean;
  /**
   * Write the roster with a pasted statement's roles added; `added` counts the new roles, and
   * `level` names the level they got in a graded draft.
   */
  onApplyStatement: (authors: Contributor[], added: number, level?: string) => void;
  onClose: () => void;
}

/** A pasted statement read against the open draft, waiting for Apply. */
interface StatementReview {
  /**
   * Per contributor, the roles Apply gives them (`set` ones the grid already has; `note` as in ReadRole),
   * the model's suggestions (`accepted` ones are in `roles` too), and the roles the model nearly gave.
   */
  rows: {
    id: string;
    name: string;
    roles: (ReadRole & { set: boolean })[];
    suggested: { role: CreditRoleName; accepted: boolean }[];
    maybe: CreditRoleName[];
  }[];
  /** Names or initials that fit no contributor, or several, with the roles left out unless picked. */
  unmatched: { token: string; candidates: { id: string; name: string }[]; roles: CreditRoleName[] }[];
  /** Roles the roster does not have yet. Ones already set are left as they are. */
  added: number;
  /** Contributors who gain at least one role. */
  people: number;
  /** Whether the rules found any role; when not, a model reading stands alone. */
  rulesFound: boolean;
}

/** A model suggestion the user took, as `${contributor id} ${role}`. */
const suggestionKey = (id: string, role: CreditRoleName) => `${id} ${role}`;

// A line that ends on one of these runs on into the next: "Conceptualization, A.B.,\nC.D.".
const RUNS_ON_RE = /(?:[,:&‐-―−-]|(?<!\p{L})and)$/iu;
// So does a line followed by one that starts lower-case or with "and": "Formal\nanalysis".
const RUNS_ON_FROM_RE = /^(?:\p{Ll}|and\b)/u;

/**
 * A line break as the end of a clause, as most statements laid out one person per line mean it:
 * "A.B. - conceptualization\nC.D. - software". The shared parser reads it as a space, as the
 * census does, so this applies to pasted text only.
 */
function breakLines(text: string): string {
  let joined = "";
  let last = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Test the previous line, not all of `joined`: the end-anchored regex rescanned the whole
    // text per line, and a 2 MB paste of short lines froze the tab for minutes.
    const runsOn = RUNS_ON_RE.test(last) || RUNS_ON_FROM_RE.test(trimmed);
    joined = joined ? `${joined}${runsOn ? " " : "; "}${trimmed}` : trimmed;
    last = trimmed;
  }
  return joined;
}

/**
 * Read a prepared statement against the roster, checked against the model's reading when there is one.
 * `picks` maps an unmatched token to the contributor id the user chose for it, who then gets that token's
 * roles; `accepted` holds the model suggestions the user took (suggestionKey).
 */
function reviewStatement(
  text: string,
  authors: Contributor[],
  picks: Record<string, string>,
  model?: ReaderResult,
  accepted: ReadonlySet<string> = new Set(),
): StatementReview {
  const { assignments, unmatched } = parseStatement(text, authors.map(statementAuthor));
  const picked = unmatched.flatMap(({ token, roles }) => {
    const author = authors.findIndex((a) => a.id === picks[token]);
    return author < 0 ? [] : roles.map((role) => ({ author, role }));
  });
  const found = [...assignments, ...picked];
  // Counted before picks, so picking who a token means never switches to or from the model's own reading.
  const rulesRead = assignments.length > 0 || unmatched.some(({ roles }) => roles.length > 0);
  return summarize(
    authors,
    combine(
      authors.map((_, i) => found.filter((a) => a.author === i).map(({ role }) => role)),
      model,
      rulesRead,
    ),
    unmatched.map((u) => ({
      ...u,
      candidates: u.candidates.flatMap((i) => (authors[i] ? [{ id: authors[i].id, name: authors[i].name }] : [])),
    })),
    accepted,
    rulesRead,
  );
}

/** The name the model reads: given names, then the surname, as in the census's training bylines. */
function modelName(author: Contributor): string {
  const { given, surname } = statementAuthor(author);
  return [given, surname].filter(Boolean).join(" ") || author.name;
}

const byCreditOrder = (roles: Iterable<CreditRoleName>) => {
  const wanted = new Set(roles);
  return CREDIT_ROLES.filter(({ name }) => wanted.has(name)).map(({ name }) => name);
};

function summarize(
  authors: Contributor[],
  readings: AuthorReading[],
  unmatched: StatementReview["unmatched"],
  accepted: ReadonlySet<string>,
  rulesFound: boolean,
): StatementReview {
  const rows = authors.map((author, i) => {
    const set = new Set(author.contributions.filter((c) => c.score > 0).map((c) => c.role));
    const reading = readings[i] ?? { roles: [], suggested: [], maybe: [] };
    const notes = new Map(reading.roles.map(({ role, note }) => [role, note]));
    // A suggestion the grid already has adds nothing, so it is not offered.
    const suggested = byCreditOrder(reading.suggested)
      .filter((role) => !set.has(role))
      .map((role) => ({ role, accepted: accepted.has(suggestionKey(author.id, role)) }));
    for (const { role } of suggested.filter((s) => s.accepted)) notes.set(role, undefined);
    return {
      id: author.id,
      name: author.name,
      roles: byCreditOrder(notes.keys()).map((role) => {
        const note = notes.get(role);
        return { role, set: set.has(role), ...(note ? { note } : {}) };
      }),
      suggested,
      maybe: reading.maybe,
    };
  });
  const gaining = rows.filter((row) => row.roles.some((r) => !r.set));
  return {
    rows,
    unmatched,
    added: gaining.reduce((sum, row) => sum + row.roles.filter((r) => !r.set).length, 0),
    people: gaining.length,
    rulesFound,
  };
}

/**
 * The roster with the reviewed roles set to `score`, matched by contributor id. A role already
 * set keeps its level, and a contributor the review does not know is left alone.
 */
function withStatementRoles(authors: Contributor[], review: StatementReview, score: number): [Contributor[], number] {
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

/** The picker value for an ambiguous token left out; Radix reserves the empty string. */
const LEAVE_OUT = "leave-out";

export type ImportMode = "add" | "replace";

/** What a resolved import is waiting to write, once any replace is confirmed. */
export interface PendingImport {
  authors: Contributor[];
  doiNotice?: "doiRolesImported" | "doiNoRoles";
  /** Set only by the DOI path; the other importers give no title. */
  title?: string;
  /** Co-author asks and answers, from a JSON export that has them. */
  asks?: Record<string, Ask>;
  /** The contributor who made a JSON export, under the file's own id. */
  selfId?: string;
  toolchain?: Toolchain;
  /** The file named a writing tool this build does not know, so it was left out. */
  toolchainDropped?: boolean;
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

/** The file picker's types, also listed beside it. */
const ACCEPTED_FILE_TYPES = [".csv", ".tsv", ".json", ".xml", ".cff"];

/** The "nothing found" message for each importable format. */
const EMPTY_MESSAGE_KEYS: Record<Exclude<DetectedFormat, "unknown" | "link" | "statement">, MessageKey> = {
  json: "errImportNoJsonContributors",
  codemeta: "errImportNoCitationAuthors",
  cff: "errImportNoCitationAuthors",
  zenodo: "errImportNoCitationAuthors",
  csv: "errImportNoCsvRows",
  tenzing: "errImportNoCsvRows",
  xml: "errImportNoXmlContribs",
  crossref: "errImportNoCrossrefContribs",
  names: "errImportNoNames",
};

/** Label shown beside the paste area; "JATS4R XML" and "CSV" are format names, not prose. */
const FORMAT_LABEL: Record<Exclude<DetectedFormat, "unknown">, (t: ReturnType<typeof useTranslations>) => string> = {
  codemeta: () => "CodeMeta",
  cff: () => "CITATION.cff",
  zenodo: () => ".zenodo.json",
  names: (t) => t("importAuthorList"),
  link: (t) => t("formatShareLink"),
  json: (t) => t("formatJsonExport"),
  statement: (t) => t("formatStatement"),
  xml: () => "JATS4R XML",
  crossref: () => "Crossref XML",
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
  // The statement under review, the contributor chosen per ambiguous token, and the model suggestions taken
  // (suggestionKey); the review itself is derived, so a choice updates the counts, the rows and Apply together.
  const [reviewed, setReviewed] = useState<{
    statement: string;
    picks: Record<string, string>;
    accepted: string[];
  } | null>(null);
  // Keyed on the statement and the names read: a new statement, a roster change, Back or closing drops it.
  const { reading: modelRead, read: readWithModel } = useStatementReading(
    reviewed?.statement ?? null,
    draftAuthors.map(modelName),
  );
  const review =
    reviewed &&
    reviewStatement(
      reviewed.statement,
      draftAuthors,
      reviewed.picks,
      modelRead?.status === "done" ? modelRead.result : undefined,
      new Set(reviewed.accepted),
    );
  const noRoles = review?.rows.filter((row) => row.roles.length === 0 && row.suggested.length === 0) ?? [];
  const reviewOpen = reviewed !== null;
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
  // Bumped per lookup and on close: a DOI result whose number is no longer current
  // belongs to a newer lookup or a dialog the user has left, and must not import or confirm.
  const request = useRef(0);
  // Bumped on close and unmount: an import that settles after either must not land.
  const closes = useRef(0);
  // Only the last selected file may replace the textarea.
  const fileRead = useRef(0);
  // Ends the citation converter's worker when its import is no longer wanted.
  const converting = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      closes.current += 1;
      request.current += 1;
      converting.current?.abort();
    },
    [],
  );

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
    if (reviewOpen) reviewHeadingRef.current?.focus();
    else if (backedOut.current) {
      backedOut.current = false;
      importRef.current?.focus();
    }
  }, [reviewOpen]);

  // Success replaces the read button with its outcome; if focus went with the button, the heading takes it.
  useEffect(() => {
    if (modelRead?.status === "done" && !dialog?.contains(document.activeElement)) reviewHeadingRef.current?.focus();
  }, [modelRead?.status, dialog]);

  const format = detectFormat(text);

  /** Show an import error and announce it (errors interrupt via role="alert"). */
  function showError(message: string, where: "doi" | "form" = "form") {
    setError({ where, message });
    announce(message, { assertive: true });
  }

  useModalDialog(dialog, open);

  async function handleFileRead(file: File) {
    const read = ++fileRead.current;
    if (file.size > MAX_IMPORT_BYTES) {
      showError(t("errFileTooLarge", { limit: MAX_IMPORT_MB }));
      return;
    }
    const started = closes.current;
    try {
      const content = await file.text();
      if (started !== closes.current || read !== fileRead.current) return;
      setText(content);
      // A staged confirmation holds the earlier text's parse; without a focus jump, it goes.
      hadPending.current = false;
      setPending(null);
      setReviewed(null);
      setFileName(file.name);
      setError(null);
    } catch {
      if (started === closes.current && read === fileRead.current) showError(t("errFileUnreadable"));
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
    const started = closes.current;
    const current = () => started === closes.current;
    converting.current?.abort();
    const controller = new AbortController();
    converting.current = controller;
    setImporting(true);
    try {
      if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
        showError(t("errImportTooLarge", { limit: MAX_IMPORT_MB }));
        return;
      }
      if (format === "link") {
        // The whole-draft and merge cases both need the current workspace, so
        // the caller owns this one; failures come back as a message key.
        const failure = await onLink(text.trim(), current);
        if (!current()) return;
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
        // Opened even when the rules find nothing, as for prose ("A.B. wrote the paper"): the review
        // offers the model.
        setReviewed({ statement, picks: {}, accepted: [] });
        return;
      }
      const parsed = await importAny(text, {
        convertCitation: (input, kind) => convertCitation(input, kind, controller.signal),
      });
      if (!current()) return;
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
      if (!current()) return;
      stageImport({ ...parsed, toolchainDropped: parsed.warnings?.includes(UNKNOWN_TOOLCHAIN_WARNING) });
    } catch (failure) {
      if (!current()) return;
      // Only a converter that could not load fits the "try again online" message; a bad file falls through.
      if (failure instanceof ConverterUnavailableError) {
        showError(t("errCitationConverter"));
        return;
      }
      if (failure instanceof ScoreCellError) {
        showError(t("errImportScoreCell", { row: failure.row, column: failure.column, value: failure.value }));
        return;
      }
      // A newer build's export, or one that repeats an id, is said plainly, not as a validation failure.
      showError(
        t(
          failure instanceof NewerVersionError
            ? "errImportNewerVersion"
            : failure instanceof RepeatedIdError
              ? "errImportRepeatedId"
              : failure instanceof XmlParseError
                ? "errImportXmlUnreadable"
                : failure instanceof ExportOnlyError
                  ? "errImportExportOnly"
                  : "errImportFailed",
        ),
      );
    } finally {
      // After a close, the flag belongs to whatever the reopened dialog started.
      if (current()) setImporting(false);
    }
  }

  /** Import straight away, or hold it behind the replace confirmation. */
  function stageImport(next: PendingImport) {
    if (existingContributorCount > 0 || next.doiNotice || next.toolchainDropped) {
      setPending(next);
      return;
    }
    finishImport(next, "replace");
  }

  async function handleDoiLookup() {
    setError(null);
    const trimmed = normalizeDoi(doi);
    if (!DOI_INPUT_REGEX.test(trimmed)) {
      showError(t("errDoiINVALID_DOI"), "doi");
      return;
    }
    const lookup = ++request.current;
    setDoiLoading(true);
    const result = await fetchDoiWork(trimmed);
    if (lookup !== request.current) return;
    setDoiLoading(false);
    if (!("ok" in result)) {
      showError(t(DOI_ERROR_KEYS[result.code]), "doi");
      return;
    }
    // One unusable deposited name must not discard the other contributors.
    const authors = result.authors.flatMap((author) => {
      try {
        return [
          createAuthor(author.name, {
            ...(author.orcid ? { orcid: author.orcid } : {}),
            contributions: (author.roles ?? []).map((role) => ({ role, score: 100 })),
          }),
        ];
      } catch {
        return [];
      }
    });
    if (authors.length === 0) {
      showError(t("errImportFailed"), "doi");
      return;
    }
    stageImport({
      authors,
      title: result.title,
      doiNotice: result.authors.some((author) => author.roles?.length) ? "doiRolesImported" : "doiNoRoles",
    });
  }

  function finishImport(next: PendingImport, mode: ImportMode) {
    if (mode === "add" && draftAuthors.length + newContributors(draftAuthors, next.authors).length > MAX_AUTHORS) {
      showError(t("errTooManyContributors", { limit: MAX_AUTHORS }));
      return;
    }
    // `onImport` runs the authors back through the store's normalizeRoster,
    // which throws on anything createAuthor cannot rebuild. On the confirm
    // path this sits outside handleImport's try, so an unguarded throw here
    // escaped the click handler instead of showing as an import error.
    try {
      onImport(next, mode);
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
    setReviewed(null);
    dialog?.close();
  }

  function handleClose() {
    converting.current?.abort();
    request.current += 1;
    closes.current += 1;
    setDoiLoading(false);
    setImporting(false);
    setText("");
    setDoi("");
    setFileName(null);
    setError(null);
    setPending(null);
    setReviewed(null);
    onClose();
  }

  const citation = format === "cff" || format === "zenodo";
  const busy = importing || doiLoading;
  const label = "block text-[13px] font-semibold text-on-surface";
  const secondary =
    "rounded-lg border border-outline-strong px-4 py-2 font-semibold text-on-surface-variant transition-[color,box-shadow] hover:shadow-card hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  // Only asked once the draft has contributors; the DOI preview on an empty draft just confirms.
  const addable = pending && existingContributorCount > 0 ? newContributors(draftAuthors, pending.authors).length : 0;

  // The dialog keeps the browser's position: fixed, which also anchors the Close button. With
  // `relative` it would scroll away with the page when focus moves down it on a phone.
  return (
    <dialog
      ref={setDialog}
      aria-labelledby="import-title"
      aria-describedby="import-description"
      onClose={handleClose}
      {...closeOnBackdrop}
      onDragOver={swallowDrag}
      onDrop={swallowDrag}
      className="m-auto w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden rounded border border-edge bg-surface-bright p-0 text-on-surface shadow-sheet backdrop:bg-on-surface/30 backdrop:backdrop-blur-sm"
    >
      <div>
        <div className="py-4 pl-8 pr-14 border-b border-outline-variant/10 bg-surface-container-low">
          <h2
            id="import-title"
            className="text-2xl italic font-semibold text-primary"
            style={{ fontFamily: "var(--font-headline)" }}
          >
            {t("importTitle")}
          </h2>
          <p id="import-description" className="text-sm text-on-surface-variant mt-1">
            {t("importSummary")}
          </p>
          <button
            type="button"
            onClick={() => dialog?.close()}
            className="touch-target absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X aria-hidden="true" className="h-5 w-5" />
            <span className="sr-only">{t("close")}</span>
          </button>
        </div>

        <div className="px-8 py-5 space-y-4">
          {/* Text area */}
          <div>
            <div className="flex justify-between items-end gap-x-3 mb-2">
              <label htmlFor="import-text" className={label}>
                {t("pasteRawData")}
              </label>
              {/* Always mounted, so a screen reader hears the file and format as they appear. */}
              <div role="status" className="flex flex-wrap justify-end gap-x-3">
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
                setReviewed(null);
                // A staged confirmation holds the old text's parse. Dropping it here leaves focus in the
                // textarea instead of the effect moving it to Import.
                hadPending.current = false;
                setPending(null);
              }}
              placeholder={t("importPlaceholder", { names: t("sampleNames") })}
              rows={6}
              className="w-full rounded border border-edge bg-surface-bright focus:ring-2 focus:ring-primary outline-none text-sm font-mono p-4 text-on-surface placeholder:text-on-surface-variant resize-none transition-shadow"
            />
            {citation && (
              <ExternalLink
                className="mt-1 flex w-fit gap-1 text-sm text-primary underline"
                href="https://simonvanlierde.com/citesync/"
              >
                {t("citationPlayground")}
              </ExternalLink>
            )}
          </div>

          {error?.where === "form" && (
            <p
              id="import-form-error"
              role="alert"
              className="text-sm text-error bg-error-container/30 rounded px-4 py-2"
            >
              {error.message}
            </p>
          )}

          {/* Drop zone */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a mouse-only progressive enhancement; the Browse button + file input below provide the accessible path. */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: same as above. */}
          <div
            onDragOver={handleFileDragOver}
            onDragLeave={handleFileDragLeave}
            onDrop={handleFileDrop}
            className={`border-2 border-dashed rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-3 transition-colors ${
              dragging ? "border-primary bg-surface-container" : "border-outline-strong bg-surface"
            }`}
          >
            <div className="w-10 h-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
              <FileUp aria-hidden="true" className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              {/* Touch screens have nothing to drag from: there the button is the whole story. */}
              <p className="text-sm font-medium text-on-surface pointer-coarse:hidden">{t("dragDropFile")}</p>
              <p className="text-xs text-on-surface-variant mt-0.5 pointer-coarse:mt-0">
                {t("acceptedFileTypes", { types: formatter.list(ACCEPTED_FILE_TYPES, { type: "disjunction" }) })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="shrink-0 px-4 py-1.5 border border-primary text-primary text-xs font-semibold rounded hover:bg-primary hover:text-on-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {t("browseFiles")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES.join(",")}
              className="hidden"
              onChange={handleFileInput}
            />
          </div>

          <details className="group text-sm">
            <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
              <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
              {t("importFormatsToggle")}
            </summary>
            <p className="mt-1 max-w-prose text-on-surface-variant">{t("importDescription")}</p>
          </details>

          {/* DOI lookup: the other way in, below the paste-or-upload route most imports take. */}
          <div>
            <div aria-hidden="true" className="mb-3 flex items-center gap-3 text-xs text-on-surface-variant">
              <span className="h-px flex-1 bg-outline" />
              {t("importOr")}
              <span className="h-px flex-1 bg-outline" />
            </div>
            <label htmlFor="import-doi" className={`${label} mb-2`}>
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
                    if (doiLoading || importing || pending !== null) return;
                    void handleDoiLookup();
                  }
                }}
                placeholder={t("doiPlaceholder")}
                className="flex-1 min-w-0 rounded border border-edge bg-surface-bright focus:ring-2 focus:ring-primary outline-none text-sm font-mono placeholder:font-sans px-4 py-2 text-on-surface placeholder:text-on-surface-variant transition-shadow"
              />
              <button
                type="button"
                onClick={() => void handleDoiLookup()}
                // One at a time: whichever landed second would replace the other's staged import.
                disabled={doiLoading || importing || doi.trim().length === 0 || pending !== null}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-primary px-4 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-primary"
              >
                <Search aria-hidden="true" className="h-4 w-4" />
                {doiLoading ? t("doiLookingUp") : t("doiLookUp")}
              </button>
            </div>
            {/* One slot for both, floored at the hint's two lines: swapping a
                one-line error in for the hint must not move the panels below. */}
            {error?.where === "doi" ? (
              <p id="import-doi-note" role="alert" className="mt-2 min-h-8 text-xs text-error">
                {error.message}
              </p>
            ) : (
              <p id="import-doi-note" className="mt-2 min-h-8 text-xs text-on-surface-variant">
                {t("doiHint")}
              </p>
            )}
          </div>

          {pending && (
            <div role="alert" className="rounded-lg bg-surface-container-low p-4 text-sm text-on-surface">
              <p className="font-semibold">
                {t(existingContributorCount ? "importChoiceTitle" : pending.doiNotice ? "doiConfirm" : "importData")}
              </p>
              {pending.doiNotice && <p className="mt-1">{t(pending.doiNotice)}</p>}
              {pending.toolchainDropped && <p className="mt-1">{t("importToolchainDropped")}</p>}
              {pending.doiNotice === "doiRolesImported" && (
                <ul className="mt-2 list-disc pl-5">
                  {pending.authors.map((author) => (
                    <li key={author.id}>
                      {author.name}:{" "}
                      {author.contributions
                        .filter((c) => c.score > 0)
                        .map((c) => translateInterfaceRole(c.role))
                        .join(", ") || "—"}
                    </li>
                  ))}
                </ul>
              )}
              {existingContributorCount > 0 && (
                <p className="mt-1 text-on-surface-variant">
                  {t("replaceWorkspaceBody", {
                    incoming: pending.authors.length,
                    existing: existingContributorCount,
                  })}
                </p>
              )}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button ref={keepRef} type="button" onClick={() => setPending(null)} className={secondary}>
                  {t(existingContributorCount ? "keepCurrentWork" : "cancel")}
                </button>
                {existingContributorCount > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => finishImport(pending, "replace")}
                      className="rounded-lg border border-error px-4 py-2 font-semibold text-error transition-colors hover:bg-error hover:text-on-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {t("replaceWorkspace")}
                    </button>
                    <button
                      type="button"
                      onClick={() => finishImport(pending, "add")}
                      disabled={addable === 0}
                      className="rounded bg-primary shadow-press px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-on-surface-variant disabled:ring-1 disabled:ring-outline-variant"
                    >
                      {t("importAddNew", { count: addable })}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => finishImport(pending, "replace")}
                    className="rounded bg-primary shadow-press px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    {t(pending.doiNotice ? "doiConfirm" : "importData")}
                  </button>
                )}
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
                {review.rows.every((row) => row.roles.length === 0)
                  ? namesCredit(reviewed.statement) || modelRead?.status === "done"
                    ? t("errStatementNoRoles")
                    : `${t("errStatementNoRoles")} ${t("statementOnlyCredit")}`
                  : review.added === 0
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
                    <SelectContent container={dialog}>
                      {ASSIGNABLE_LEVELS.map(({ key, score }) => (
                        <SelectItem key={key} value={String(score)}>
                          {translateInterfaceUi(key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* A live region from the start, so the outcome replacing this text is spoken; the layout's
                    announcer is outside this modal dialog and inert while it is open. */}
                <p role="status" className="min-w-0 flex-1 basis-64 text-on-surface-variant">
                  {modelRead?.status === "done"
                    ? t(review.rulesFound ? "statementReaderChecked" : "statementReaderUsed")
                    : t("statementReaderAbout", {
                        size: formatter.number(MODEL_BYTES / 1e6, {
                          style: "unit",
                          unit: "megabyte",
                          maximumFractionDigits: 0,
                        }),
                      })}
                </p>
                {modelRead?.status !== "done" && (
                  <button
                    type="button"
                    // Not `disabled` while loading: that would drop keyboard focus to the page.
                    onClick={() => modelRead?.status !== "loading" && void readWithModel()}
                    aria-disabled={modelRead?.status === "loading"}
                    aria-busy={modelRead?.status === "loading"}
                    className={`inline-flex shrink-0 items-center gap-2 ${secondary} ${modelRead?.status === "loading" ? "cursor-progress opacity-70" : ""}`}
                  >
                    {modelRead?.status === "loading" && (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                    )}
                    {t("statementReaderRead")}
                  </button>
                )}
                {modelRead?.status === "failed" && (
                  <p role="alert" className="basis-full text-on-surface">
                    {t("statementReaderFailed")}
                  </p>
                )}
              </div>
              <ul className="mt-3 divide-y divide-outline-variant/30 border-y border-outline-variant/30">
                {review.rows
                  .filter((row) => row.roles.length > 0 || row.suggested.length > 0 || row.maybe.length > 0)
                  .map((row) => (
                    <li
                      key={row.id}
                      className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]"
                    >
                      <span className="font-medium break-words text-on-surface">{row.name}</span>
                      <div className="min-w-0 space-y-1">
                        {row.roles.length > 0 && (
                          // Commas only: an "and" would read as part of "Review and editing".
                          <p className="text-on-surface">
                            {row.roles.map(({ role, set, note }, i) => (
                              <span key={role}>
                                {i > 0 && ", "}
                                {set ? (
                                  <span className="text-on-surface-variant">
                                    {t("statementRoleAlreadySet", { role: translateInterfaceRole(role) })}
                                  </span>
                                ) : note ? (
                                  <span className="font-semibold">
                                    {t(note === "check" ? "statementCheckRole" : "statementDoubtRole", {
                                      role: translateInterfaceRole(role),
                                    })}
                                  </span>
                                ) : (
                                  translateInterfaceRole(role)
                                )}
                              </span>
                            ))}
                          </p>
                        )}
                        {row.suggested.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span id={`statement-suggest-${row.id}`} className="text-on-surface-variant">
                              {t("statementSuggested")}
                            </span>
                            {row.suggested.map(({ role, accepted }) => (
                              <button
                                key={role}
                                type="button"
                                aria-pressed={accepted}
                                aria-describedby={`statement-suggest-${row.id}`}
                                onClick={() => {
                                  const key = suggestionKey(row.id, role);
                                  setReviewed({
                                    ...reviewed,
                                    accepted: accepted
                                      ? reviewed.accepted.filter((k) => k !== key)
                                      : [...reviewed.accepted, key],
                                  });
                                }}
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${accepted ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface hover:bg-surface-container"}`}
                              >
                                {accepted ? (
                                  <Check aria-hidden="true" className="size-3.5" />
                                ) : (
                                  <Plus aria-hidden="true" className="size-3.5" />
                                )}
                                {translateInterfaceRole(role)}
                              </button>
                            ))}
                          </div>
                        )}
                        {row.maybe.length > 0 && (
                          <p className="text-on-surface-variant">
                            {t("statementMaybe", { roles: row.maybe.map(translateInterfaceRole).join(", ") })}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
              {noRoles.length > 0 && (
                <p className="mt-2 break-words text-on-surface-variant">
                  {t("statementNoRolesFor", {
                    names: noRoles
                      .map(({ id, name }) => {
                        // Only a token with a picker can still give this person roles.
                        const tokens = review.unmatched
                          .filter((u) => u.roles.length > 0 && u.candidates.length > 1)
                          .filter((u) => u.candidates.some((c) => c.id === id))
                          .map((u) => u.token);
                        return tokens.length
                          ? `${name} ${t("statementCouldBe", { token: formatter.list(tokens, { type: "disjunction" }) })}`
                          : name;
                      })
                      .join(", "),
                  })}
                </p>
              )}
              {review.unmatched.length > 0 && (
                <div className="mt-3 flex gap-2 text-on-surface">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-on-surface-variant" />
                  <div className="min-w-0">
                    <p className="font-semibold">{t("statementUnmatchedTitle")}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {review.unmatched.map(({ token, candidates, roles }, k) => {
                        const rolesText = roles.map(translateInterfaceRole).join(", ");
                        if (candidates.length > 1 && roles.length > 0) {
                          return (
                            <li key={token} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5">
                              <span id={`statement-pick-${k}`} className="font-medium break-words">
                                {token}
                              </span>
                              <Select
                                value={reviewed.picks[token] ?? LEAVE_OUT}
                                onValueChange={(id) =>
                                  setReviewed({ ...reviewed, picks: { ...reviewed.picks, [token]: id } })
                                }
                              >
                                <SelectTrigger
                                  className="w-44"
                                  aria-labelledby={`statement-pick-${k}`}
                                  aria-describedby={`statement-pick-roles-${k}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent container={dialog}>
                                  {candidates.map(({ id, name }) => (
                                    <SelectItem key={id} value={id}>
                                      {name}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value={LEAVE_OUT}>{t("statementLeaveOut")}</SelectItem>
                                </SelectContent>
                              </Select>
                              <span id={`statement-pick-roles-${k}`} className="min-w-0 break-words">
                                {rolesText}
                              </span>
                            </li>
                          );
                        }
                        const who =
                          candidates.length > 1
                            ? t("statementUnmatchedAmbiguous", {
                                token,
                                names: formatter.list(
                                  candidates.map((c) => c.name),
                                  { type: "disjunction" },
                                ),
                              })
                            : t("statementUnmatchedNone", { token });
                        return (
                          <li key={token} className="break-words">
                            {roles.length > 0 ? t("statementLeftOut", { who, roles: rolesText }) : who}
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
                    setReviewed(null);
                  }}
                  className="rounded border border-edge bg-surface-bright px-4 py-2 font-semibold text-on-surface-variant hover:shadow-card hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t("statementBack")}
                </button>
                <button
                  type="button"
                  onClick={() => applyStatement(review)}
                  disabled={review.added === 0}
                  className="rounded bg-primary shadow-press px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("statementApply")}
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="px-8 py-3 border-t border-outline-variant/10 bg-surface-container-low flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {/* Always mounted, and two lines tall when empty, so progress appearing beside Import never moves
              it; the layout's announcer is outside this modal dialog and inert while it is open. */}
          <p role="status" className="min-h-8 min-w-0 flex-1 basis-56 text-xs text-on-surface-variant">
            {modelRead?.status === "loading" ? (
              // Constant words, so a screen reader says them once; the number beside them is for the eye.
              <>
                {t(modelRead.progress?.phase === "read" ? "statementReaderReading" : "statementReaderLoading")}
                {modelRead.progress && (
                  <span aria-hidden="true">
                    {" "}
                    {formatter.number(
                      modelRead.progress.phase === "read"
                        ? modelRead.progress.done / modelRead.progress.of
                        : modelRead.progress.percent / 100,
                      { style: "percent", maximumFractionDigits: 0 },
                    )}
                  </span>
                )}
              </>
            ) : importing && citation ? (
              t("citationConverting")
            ) : doiLoading ? (
              t("doiLookingUp")
            ) : null}
          </p>
          {/* The confirmation has its own way back and its own way on. */}
          {!pending && (
            <div className="flex shrink-0 gap-3">
              <button
                type="button"
                onClick={() => dialog?.close()}
                className="px-5 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t("cancel")}
              </button>
              {/* The review has its own Apply; a faded twin here would only compete with it. */}
              {!review && (
                <button
                  ref={importRef}
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={format === "unknown" || busy}
                  className={`inline-flex items-center gap-2 px-7 py-2 bg-primary text-on-primary text-sm font-bold rounded-lg shadow hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${busy ? "cursor-progress" : "disabled:opacity-40 disabled:cursor-not-allowed"}`}
                >
                  {busy && (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                  )}
                  {doiLoading
                    ? t("doiLookingUp")
                    : importing
                      ? t(citation ? "importConverting" : "importImporting")
                      : format === "statement"
                        ? t("statementReview")
                        : t("importData")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
