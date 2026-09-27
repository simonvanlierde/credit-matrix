"use client";

import type { Author } from "@credit-generator/core";
import { mergeContributorRow } from "@credit-generator/core";
import { Check, CircleAlert, Link2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { DraftPicker } from "@/components/DraftPicker";
import { ImportModal, type LinkFailure } from "@/components/ImportModal";
import { showStatus } from "@/components/StatusBanner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { announce } from "@/lib/announce";
import { buildShareUrl, decodeShareHash, type ShareData, shareFailureKey } from "@/lib/share";
import { useCopyStatus } from "@/lib/use-copy-status";
import { type DraftClaim, MAX_DRAFTS, useContributionStore } from "@/store/contribution-store";

/**
 * Import / Share buttons rendered in the nav bar.
 * Lives in its own Client Component so layout.tsx can stay a Server Component.
 */
export function HeaderActions() {
  const t = useTranslations();
  const [importOpen, setImportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareStatus, copyShareUrl] = useCopyStatus({
    copied: t("annLinkCopied"),
  });
  // Only the count is needed at render time; the array itself is read inside
  // the handlers via getState(), so score edits don't re-render the nav bar.
  const authorCount = useContributionStore((s) => s.authors.length);
  const loadAuthors = useContributionStore((s) => s.loadAuthors);
  const setTitle = useContributionStore((s) => s.setTitle);
  const setClaim = useContributionStore((s) => s.setClaim);
  const claim = useContributionStore((s) => s.claim);
  const createDraft = useContributionStore((s) => s.createDraft);
  const switchDraft = useContributionStore((s) => s.switchDraft);
  const deleteDraft = useContributionStore((s) => s.deleteDraft);
  const markAsked = useContributionStore((s) => s.markAsked);
  const clearAsked = useContributionStore((s) => s.clearAsked);
  const setRecentReply = useContributionStore((s) => s.setRecentReply);
  const decodedOnMount = useRef(false);

  // Rehydrate persisted state on the client (the store skips hydration at
  // creation to avoid an SSR mismatch). Runs before the share-hash effect below
  // so a `#s=…` link still wins over whatever was restored from localStorage.
  useEffect(() => {
    void useContributionStore.persist.rehydrate();
  }, []);

  // The listener is registered once, so it must not capture this render's
  // handler: `t` changes with the interface language, and a hash pasted after
  // that switch has to speak the new one.
  const handlerRef = useRef(handleIncomingHash);
  useEffect(() => {
    handlerRef.current = handleIncomingHash;
  });

  // Mount + hashchange share one handler: pasting a link into an already-open
  // tab must react exactly like opening it fresh.
  useEffect(() => {
    const handle = () => void handlerRef.current();
    // StrictMode re-runs effects in development; the mount decode would then
    // load the link twice. A ref survives that re-run, an effect body does not.
    if (!decodedOnMount.current) {
      decodedOnMount.current = true;
      handle();
    }
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);

  async function handleIncomingHash(): Promise<void> {
    const hash = window.location.hash;
    if (!hash.startsWith("#s=")) return;
    // On mount this can beat the rehydrate effect above; awaiting it (a no-op
    // once done) keeps the link from opening over a draft not yet restored.
    await useContributionStore.persist.rehydrate();
    const shared = await decodeShareHash(hash);
    if (!shared || shared.authors.length === 0) {
      // A link that says it is a share but does not decode is worth a visible
      // verdict; the workspace is untouched either way.
      showStatus({ kind: "error", message: t("errShareLinkBroken") });
      return;
    }
    const failure = openFromLink(shared);
    if (failure) {
      showStatus({
        kind: "error",
        message: failure === "draftLimitReached" ? t(failure, { count: MAX_DRAFTS }) : t(failure),
      });
      return;
    }
    // Drop only the fragment; keep any query string intact.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  /**
   * Route a decoded link. One function for every entry path (opened, pasted in
   * the URL bar, pasted into Import), so the same artifact always behaves the
   * same way. Success paths surface their own status; failures return a key so
   * the Import dialog can render them inline and stay open.
   */
  function openFromLink(shared: ShareData): LinkFailure | null {
    const state = useContributionStore.getState();
    const isLocal = (id: string | null): id is string =>
      id !== null && (id === state.activeDraftId || !!state.drafts[id]);

    // A reply to a request: merge one row into the draft it was asked about.
    if (shared.reply && shared.claimId) {
      const target = shared.sourceDraftId;
      if (!isLocal(target)) return "mergeWrongDraft";
      // Merge against the named draft's roster *before* going there: a reply
      // that turns out to be unusable must leave you on the paper you were on.
      const before = target === state.activeDraftId ? state.authors : (state.drafts[target]?.authors ?? []);
      const result = mergeContributorRow(before, shared.authors, shared.claimId);
      if (result.unmatched) return "mergeUnmatched";
      if (!result.merged) return "errShareLinkBroken";
      // loadAuthors writes into the live draft, so the switch has to come
      // first; a throw leaves state untouched, and going back undoes the move.
      const previous = state.activeDraftId;
      switchDraft(target);
      try {
        loadAuthors(result.authors);
      } catch {
        switchDraft(previous);
        return "errShareLinkBroken";
      }
      // The reply answers the ask, so the row's "Asked" chip comes down — and
      // goes back up if the merge is undone, because the ask is open again.
      const mergedId = result.merged.id;
      const askedAt = useContributionStore.getState().asked[mergedId];
      if (askedAt !== undefined) clearAsked(mergedId);
      // Mark the row itself, so the status strip's message has a visible
      // counterpart where the change actually landed. The strip owns the
      // mark's lifetime through onDismiss below: dismissing, undoing, timing
      // out, or being replaced all take the mark down with the message.
      setRecentReply(mergedId);
      const title = useContributionStore.getState().title.trim() || t("untitledDraft");
      showStatus({
        kind: "success",
        message: t("mergedRowInto", { name: result.merged.name, title }),
        action: {
          label: t("undo"),
          onAct: () => {
            // The strip lives a minute, long enough to switch drafts under it.
            // Put the roster back where it came from, or nowhere at all.
            switchDraft(target);
            if (useContributionStore.getState().activeDraftId !== target) return;
            loadAuthors(before);
            if (askedAt !== undefined) markAsked(mergedId);
            setRecentReply(null);
            announce(t("annMergeUndone"));
          },
        },
        onDismiss: () => {
          // Guarded by id: a newer merge owns the mark by now, and this
          // strip's departure must not take the newer mark down.
          if (useContributionStore.getState().recentReply === mergedId) setRecentReply(null);
        },
      });
      return null;
    }

    // A request: either your own request link, a request you already answered,
    // or a fresh claim to open locked.
    if (shared.claimId && shared.sourceDraftId) {
      const claimedName = shared.authors.find((author) => author.id === shared.claimId)?.name ?? "";
      if (isLocal(shared.sourceDraftId)) {
        // The originator opened the link they built. Not a claim: just go there.
        if (shared.sourceDraftId !== state.activeDraftId) switchDraft(shared.sourceDraftId);
        showStatus({ kind: "success", message: t("requestLinkOwn", { name: claimedName }) });
        return null;
      }
      const matches = (candidate: DraftClaim | null) =>
        candidate?.contributorId === shared.claimId && candidate.sourceDraftId === shared.sourceDraftId;
      if (matches(state.claim)) {
        showStatus({ kind: "success", message: t("claimResumed") });
        return null;
      }
      // The active draft's map copy is only as fresh as its last stash; its
      // truth is state.claim, checked above. Without the id filter, unlocking
      // the open draft and re-opening the same link would "resume" a claim
      // that no longer exists.
      const existing = Object.values(state.drafts).find(
        (draft) => draft.id !== state.activeDraftId && matches(draft.claim),
      );
      if (existing) {
        // Re-opening the same request revisits the draft it made, never forks it.
        switchDraft(existing.id);
        showStatus({ kind: "success", message: t("claimResumed") });
        return null;
      }
      try {
        if (loadSharedAuthors(shared) === "limit") return "draftLimitReached";
      } catch {
        return "errShareLinkBroken";
      }
      setClaim({ contributorId: shared.claimId, sourceDraftId: shared.sourceDraftId });
      return null;
    }

    // A whole shared draft, addressed to nobody.
    try {
      const outcome = loadSharedAuthors(shared);
      if (outcome === "limit") return "draftLimitReached";
      showStatus({
        kind: "success",
        message: t(outcome === "occupied" ? "sharedDraftOpened" : "sharedDraftLoaded"),
      });
    } catch {
      return "errShareLinkBroken";
    }
    return null;
  }

  /**
   * Load a shared roster beside the open work. Own work already here? Give the
   * link its own draft — and refuse the link when the draft cap makes that
   * impossible, because falling through would load it over the paper that is
   * open. Refusals travel back as a return value, never a status strip of their
   * own: the Import dialog has to render them inline and stay open. loadAuthors
   * may still throw on a bad payload; each caller reports that failure its own
   * way.
   */
  function loadSharedAuthors(shared: ShareData): "limit" | "occupied" | "fresh" {
    const occupied = useContributionStore.getState().authors.length > 0;
    const created = occupied ? createDraft() : null;
    if (occupied && created === null) return "limit";
    // The payload's title (or its absence) replaces whatever was here.
    setTitle(shared.title);
    try {
      loadAuthors(shared.authors);
    } catch (error) {
      // A payload that fails to load must not leave an empty draft behind;
      // deleting it also lands you back on your own most recent work.
      if (created) deleteDraft(created);
      throw error;
    }
    return occupied ? "occupied" : "fresh";
  }

  function handleImport(importedAuthors: Author[], importedTitle?: string) {
    // Errors surface in ImportModal, which keeps the dialog open on failure.
    loadAuthors(importedAuthors);
    // Only the DOI path carries a title. Guard on it rather than on emptiness,
    // so a record with no title still clears a stale one from the last import.
    if (importedTitle !== undefined) setTitle(importedTitle);
  }

  /** Take a pasted share link through the same router every other entry uses. */
  async function handleLink(url: string): Promise<LinkFailure | null> {
    const hashAt = url.indexOf("#");
    const shared = hashAt === -1 ? null : await decodeShareHash(url.slice(hashAt));
    if (!shared || shared.authors.length === 0) return "errShareLinkBroken";
    return openFromLink(shared);
  }

  async function handleShare() {
    const state = useContributionStore.getState();
    try {
      await copyShareUrl(await buildShareUrl({ authors: state.authors, title: state.title }));
      setShareOpen(false);
    } catch {
      showStatus({ kind: "error", message: t(shareFailureKey()) });
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        <DraftPicker />
        <Popover open={shareOpen} onOpenChange={setShareOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={authorCount === 0 || claim !== null}
              aria-label={t("a11yShareLink")}
              title={claim !== null ? t("claimLockedHint") : t("a11yShareLink")}
              className="touch-target flex size-9 items-center justify-center gap-2 rounded-lg border border-primary/30 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary hover:text-on-primary disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-4"
            >
              {shareStatus === "copied" ? (
                <Check className="h-4 w-4" />
              ) : shareStatus === "error" ? (
                <CircleAlert className="h-4 w-4" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              <span className="sr-only sm:not-sr-only">
                {shareStatus === "copied"
                  ? t("linkCopied")
                  : shareStatus === "error"
                    ? t("copyFailedMessage")
                    : t("share")}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)]">
            <p className="text-sm font-semibold text-on-surface">{t("shareWarningTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{t("shareWarningBody")}</p>
            <button
              type="button"
              onClick={() => void handleShare()}
              className="mt-3 inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container"
            >
              {t("copyDataLink")}
            </button>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          disabled={claim !== null}
          aria-label={t("import")}
          title={claim !== null ? t("claimLockedHint") : t("import")}
          className="touch-target flex size-9 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-on-primary shadow-sm transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-5"
        >
          <Upload className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">{t("import")}</span>
        </button>
      </div>

      <ImportModal
        open={importOpen}
        existingContributorCount={authorCount}
        onImport={handleImport}
        onLink={handleLink}
        onClose={() => setImportOpen(false)}
      />
    </>
  );
}
