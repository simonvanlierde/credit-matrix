import { Fingerprint, UserSearch, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { type Author, isValidOrcid, normalizeOrcid } from "@/core";
import { MAX_AUTHOR_NAME_LENGTH } from "@/core/author";
import { announce } from "@/lib/announce";
import { useContributionStore } from "@/store/contribution-store";
import { detectOrcid, fetchOrcidName, orcidErrorText } from "./orcid";

/**
 * One row's ORCID state: the lookup, its status, and the revealed input. The
 * row holds it, since its name field's paste and its menu reach it too.
 * `focusName` takes focus when clearing the iD unmounts the line.
 */
export function useOrcidLine(authorId: string, focusName: () => void) {
  const t = useTranslations();
  const updateAuthorName = useContributionStore((s) => s.updateAuthorName);
  const updateAuthorOrcid = useContributionStore((s) => s.updateAuthorOrcid);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookedUp, setLookedUp] = useState<string | null>(null);
  // Revealed-but-empty ORCID input.
  const [editingOrcid, setEditingOrcid] = useState(false);
  // Guard against setState after the row unmounts mid-lookup (delete/reorder).
  const mounted = useRef(true);
  useEffect(() => {
    // Set on mount, not just at creation: React re-runs effects on a StrictMode
    // remount, and the cleanup would otherwise leave this false for good, so every
    // later lookup would bail out before clearing t("doiLookingUp").
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Only the latest lookup may write: a slower, older one would otherwise pair
  // one person's name with another's iD, and clear `loading` too early.
  const lookupSeq = useRef(0);

  // The success note clears itself; an error stays until the iD is edited or the next attempt.
  useEffect(() => {
    if (lookedUp === null) return;
    const timer = setTimeout(() => setLookedUp(null), 4000);
    return () => clearTimeout(timer);
  }, [lookedUp]);

  async function lookup(orcid: string) {
    const seq = ++lookupSeq.current;
    setLoading(true);
    setLookupError(null);
    setLookedUp(null);
    const result = await fetchOrcidName(orcid);
    if (!mounted.current || seq !== lookupSeq.current) return;
    setLoading(false);
    if ("code" in result) {
      const message = orcidErrorText(result, t);
      setLookupError(message);
      announce(message, { assertive: true });
    } else if (updateAuthorName(authorId, result.displayName)) {
      setLookedUp(orcid);
      announce(t("annNameFromOrcid", { name: result.displayName }));
    } else {
      // The registry's name failed the same rules a typed name must pass;
      // the row keeps its name, so say why rather than report a success.
      const message = t(result.displayName.length > MAX_AUTHOR_NAME_LENGTH ? "errNameTooLong" : "errNameNoLetter");
      setLookupError(message);
      announce(message, { assertive: true });
    }
  }

  /** Say why the typed text was not taken, and keep the input open for the fix. */
  function rejectOrcid(message: string) {
    // Enter and the blur after it both reject the same text: say it once.
    if (message !== lookupError) announce(message, { assertive: true });
    setLookupError(message);
    setEditingOrcid(true);
  }

  /** Returns true when the iD was accepted and the editor closed. */
  function applyOrcid(orcid: string): boolean {
    if (!isValidOrcid(orcid)) {
      rejectOrcid(t("errOrcidChecksum"));
      return false;
    }
    updateAuthorOrcid(authorId, orcid);
    setEditingOrcid(false);
    setLookupError(null);
    setLookedUp(null);
    void lookup(orcid);
    return true;
  }

  function clearOrcid() {
    // A lookup still in flight is for the iD being removed; drop its answer.
    lookupSeq.current += 1;
    setLoading(false);
    updateAuthorOrcid(authorId, "");
    setLookupError(null);
    setLookedUp(null);
    setEditingOrcid(false);
    // This unmounts the whole ORCID line, including the button that was just
    // activated. Put focus on the row's name field rather than losing it.
    focusName();
  }

  return {
    loading,
    lookupError,
    lookedUp,
    editingOrcid,
    setEditingOrcid,
    lookup,
    applyOrcid,
    rejectOrcid,
    clearLookupError: () => setLookupError(null),
    clearOrcid,
  };
}

/**
 * The ORCID line under a contributor's name: the iD with its lookup and remove
 * actions, or the input revealed to add one.
 */
export function OrcidLine({
  author,
  rowLocked,
  line,
  onPaste,
}: {
  author: Author;
  rowLocked: boolean;
  line: ReturnType<typeof useOrcidLine>;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
}) {
  const t = useTranslations();
  const errorId = useId();
  // Guards an Enter-commit's unmount blur from re-applying the iD.
  const committedRef = useRef(false);
  const orcidValue = author.orcid ?? "";
  const bareOrcid = normalizeOrcid(orcidValue);
  const hasOrcid = orcidValue.length > 0;
  const orcidValid = isValidOrcid(orcidValue);

  return (
    <>
      {/* ORCID line. A 19-character iD never fits beside the type badge in this
        column, so it gets a line of its own, indented to the name column so it
        shares a left edge with the type badge above it, and with its actions on
        the same line instead of wrapping into a ragged fourth one. */}
      {(hasOrcid || line.editingOrcid || line.lookupError !== null) && (
        <div className="mt-1 flex items-center gap-1.5 pl-20">
          {hasOrcid ? (
            <>
              <a
                href={`https://orcid.org/${bareOrcid}`}
                target="_blank"
                rel="noreferrer"
                title={bareOrcid}
                className="inline-flex min-w-0 items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 font-mono text-[11px] text-on-surface-variant transition-colors hover:text-primary"
              >
                <Fingerprint className="h-3 w-3 shrink-0" />
                <span className="truncate">{bareOrcid}</span>
                {!orcidValid && (
                  <span className="shrink-0 text-error">
                    <span aria-hidden="true">✗</span>
                    <span className="sr-only">({t("a11yInvalidOrcid")})</span>
                  </span>
                )}
                <span className="sr-only">{t("opensInNewTab")}</span>
              </a>
              {!rowLocked && orcidValid && line.lookedUp !== bareOrcid && (
                <button
                  type="button"
                  disabled={line.loading}
                  onClick={() => void line.lookup(bareOrcid)}
                  aria-label={t("lookupOrcidName")}
                  title={t("lookupOrcidName")}
                  className="reveal-on-hover ml-auto inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center gap-1 text-[11px] text-primary transition-opacity hover:underline disabled:opacity-50"
                >
                  <UserSearch className="h-3.5 w-3.5" />
                  {line.loading && t("lookingUp")}
                </button>
              )}
              {!rowLocked && (
                <button
                  type="button"
                  onClick={line.clearOrcid}
                  aria-label={t("removeOrcid")}
                  className="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:text-error"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {line.lookedUp === bareOrcid && (
                <span className="shrink-0 text-[11px] leading-tight text-primary">{t("nameUpdated")}</span>
              )}
            </>
          ) : line.editingOrcid && !rowLocked ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: revealed on explicit user action, so focusing it is expected.
              autoFocus
              type="text"
              aria-label={t("a11yOrcidInput")}
              placeholder="0000-0000-0000-0000"
              title={t("a11yOrcidHint")}
              aria-invalid={line.lookupError !== null}
              aria-describedby={line.lookupError !== null ? errorId : undefined}
              onPaste={onPaste}
              onChange={line.clearLookupError}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  // Empty text makes any blur that follows close quietly too.
                  event.currentTarget.value = "";
                  line.clearLookupError();
                  line.setEditingOrcid(false);
                  return;
                }
                if (event.key !== "Enter") return;
                const orcid = detectOrcid(event.currentTarget.value);
                // Only suppress the follow-up blur when the apply actually
                // took. On a checksum failure the input stays mounted, and a
                // latched ref made the next blur discard the corrected iD.
                if (orcid) committedRef.current = line.applyOrcid(orcid);
                else if (event.currentTarget.value.trim()) line.rejectOrcid(t("errOrcidINVALID_ID"));
              }}
              onBlur={(event) => {
                if (committedRef.current) {
                  committedRef.current = false;
                  return;
                }
                const orcid = detectOrcid(event.currentTarget.value);
                if (orcid) line.applyOrcid(orcid);
                else if (event.currentTarget.value.trim()) line.rejectOrcid(t("errOrcidINVALID_ID"));
                else line.setEditingOrcid(false);
              }}
              className="w-full min-w-0 border-b border-outline-variant/40 bg-transparent p-0 font-mono text-xs text-on-surface-variant outline-none focus:border-primary focus:ring-0"
            />
          ) : null}
        </div>
      )}
      {line.lookupError !== null && (
        <p id={errorId} className="mt-1 pl-20 text-[11px] leading-tight text-error">
          {line.lookupError}
        </p>
      )}
    </>
  );
}
