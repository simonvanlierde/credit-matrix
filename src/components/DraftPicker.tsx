"use client";

import { Check, ChevronDown, Copy, FilePlus2, Files, Lock, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { announce } from "@/lib/announce";
import { type DraftClaim, MAX_DRAFTS, useContributionStore } from "@/store/contribution-store";

/** Only what a row shows. The rest of a draft is nobody's business here. */
interface DraftRow {
  id: string;
  title: string;
  contributorCount: number;
  updatedAt: number;
  claim: DraftClaim | null;
}

/**
 * Switch between drafts, one per paper.
 *
 * The live draft is held in the store's top-level fields rather than in the
 * map, so the list below is built from the map with the live one substituted
 * in: reading `drafts[activeDraftId]` alone would show the copy as it was when
 * the draft was last parked, not as it is now.
 */
export function DraftPicker() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingDeleteAll, setPendingDeleteAll] = useState(false);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  // The Delete button that was activated unmounts with the row swap, so focus
  // would fall to <body> while the popover stays open, and nothing would say
  // the question. Hand focus to Cancel (which also reads the pair) and speak
  // the question itself.
  useEffect(() => {
    if (pendingDelete === null && !pendingDeleteAll) return;
    cancelDeleteRef.current?.focus();
    announce(t(pendingDeleteAll ? "confirmDeleteAllDrafts" : "confirmDeleteDraft"));
  }, [pendingDelete, pendingDeleteAll, t]);

  const drafts = useContributionStore((s) => s.drafts);
  const activeDraftId = useContributionStore((s) => s.activeDraftId);
  const title = useContributionStore((s) => s.title);
  const authors = useContributionStore((s) => s.authors);
  const createDraft = useContributionStore((s) => s.createDraft);
  const switchDraft = useContributionStore((s) => s.switchDraft);
  const duplicateDraft = useContributionStore((s) => s.duplicateDraft);
  const deleteDraft = useContributionStore((s) => s.deleteDraft);
  const deleteAllDrafts = useContributionStore((s) => s.deleteAllDrafts);
  const claim = useContributionStore((s) => s.claim);
  const clearClaimFor = useContributionStore((s) => s.clearClaimFor);

  // The live draft is substituted in rather than read from the map: the map
  // copy is only as fresh as the last time the draft was parked.
  const rows: DraftRow[] = [
    { id: activeDraftId, title, contributorCount: authors.length, updatedAt: Number.POSITIVE_INFINITY, claim },
    ...Object.values(drafts)
      .filter((draft) => draft.id !== activeDraftId)
      .map((draft) => ({
        id: draft.id,
        title: draft.title,
        contributorCount: draft.authors.length,
        updatedAt: draft.updatedAt,
        claim: draft.claim,
      })),
  ].sort((a, b) => b.updatedAt - a.updatedAt);

  const label = title.trim() || t("untitledDraft");

  function handleCreate() {
    if (createDraft() === null) {
      announce(t("draftLimitReached", { count: MAX_DRAFTS }), { assertive: true });
      return;
    }
    announce(t("draftCreated"));
    setOpen(false);
  }

  function handleDuplicate(draftId: string) {
    if (duplicateDraft(draftId) === null) {
      announce(t("draftLimitReached", { count: MAX_DRAFTS }), { assertive: true });
      return;
    }
    announce(t("draftDuplicated"));
  }

  function handleDelete(draftId: string) {
    deleteDraft(draftId);
    setPendingDelete(null);
    announce(t("draftDeleted"));
  }

  function handleDeleteAll() {
    deleteAllDrafts();
    setPendingDeleteAll(false);
    announce(t("allDraftsDeleted"));
  }

  /** Only one question at a time: asking about one draft withdraws the other question. */
  function askDelete(draftId: string | null, all = false) {
    setPendingDelete(draftId);
    setPendingDeleteAll(all);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A pending confirmation should not be waiting the next time this opens.
        if (!next) askDelete(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          // Names the control *and* which draft is live: below `sm` the title is
          // hidden, and without this the button would announce only "Drafts".
          aria-label={`${t("drafts")}: ${label}`}
          className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface sm:max-w-[16rem]"
        >
          <Files className="h-4 w-4 shrink-0" />
          {/* The title is the first thing to go on a narrow header: the icon
              still opens the list, where the title is spelled out in full. */}
          <span className="hidden truncate sm:inline">{label}</span>
          <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 sm:block" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <ul className="max-h-64 overflow-y-auto py-1">
          {rows.map((draft) => (
            <li key={draft.id} className="group flex items-center gap-1 px-2">
              {pendingDelete === draft.id ? (
                <div className="flex w-full items-center justify-between gap-2 rounded-lg bg-error-container/30 px-2 py-1.5">
                  <span className="text-xs text-on-surface">{t("confirmDeleteDraft")}</span>
                  <span className="flex gap-1">
                    <button
                      ref={cancelDeleteRef}
                      type="button"
                      onClick={() => askDelete(null)}
                      className="rounded px-2 py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(draft.id)}
                      className="rounded bg-error px-2 py-1 text-xs font-semibold text-on-error hover:opacity-90"
                    >
                      {t("deleteDraft")}
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      switchDraft(draft.id);
                      setOpen(false);
                    }}
                    aria-current={draft.id === activeDraftId}
                    aria-label={t("switchToDraft", { title: draft.title.trim() || t("untitledDraft") })}
                    className={`flex min-w-0 flex-1 flex-col items-start rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-container ${
                      draft.id === activeDraftId ? "text-primary" : "text-on-surface"
                    }`}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {draft.title.trim() || t("untitledDraft")}
                      </span>
                      {/* The open draft is marked, not merely tinted: colour
                          alone is not a distinction everyone can see. */}
                      {draft.id === activeDraftId && (
                        <Check className="h-3.5 w-3.5 shrink-0" aria-label={t("activeDraft")} />
                      )}
                    </span>
                    <span className="text-[11px] text-on-surface-variant">
                      {t("contributorCount", { count: draft.contributorCount })}
                    </span>
                  </button>
                  {/* Always visible, not reveal-on-hover: it doubles as the
                      lock indicator. Duplicate and delete stay available — the
                      lock governs the roster, not the draft. */}
                  {draft.claim && (
                    <button
                      type="button"
                      onClick={() => {
                        clearClaimFor(draft.id);
                        announce(t("annClaimUnlocked"));
                      }}
                      aria-label={t("claimUnlock")}
                      title={`${t("claimLockedDraft")} — ${t("claimUnlock")}`}
                      className="rounded p-1.5 text-on-surface-variant transition-colors hover:text-primary"
                    >
                      <Lock className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDuplicate(draft.id)}
                    aria-label={t("duplicateDraft")}
                    title={t("duplicateDraft")}
                    className="rounded p-1.5 text-on-surface-variant reveal-on-hover transition-[color,opacity] hover:text-primary"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => askDelete(draft.id)}
                    aria-label={t("deleteDraft")}
                    title={t("deleteDraft")}
                    className="rounded p-1.5 text-on-surface-variant reveal-on-hover transition-[color,opacity] hover:text-error"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="border-t border-outline-variant/20 p-2">
          <button
            type="button"
            onClick={handleCreate}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-primary transition-colors hover:bg-surface-container"
          >
            <FilePlus2 className="h-4 w-4" />
            {t("newDraft")}
          </button>
          {pendingDeleteAll ? (
            <div className="flex w-full items-center justify-between gap-2 rounded-lg bg-error-container/30 px-2 py-1.5">
              <span className="text-xs text-on-surface">{t("confirmDeleteAllDrafts")}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  ref={cancelDeleteRef}
                  type="button"
                  onClick={() => askDelete(null)}
                  className="rounded px-2 py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAll}
                  className="rounded bg-error px-2 py-1 text-xs font-semibold text-on-error hover:opacity-90"
                >
                  {t("deleteDraft")}
                </button>
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => askDelete(null, true)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-error"
            >
              <Trash2 className="h-4 w-4" />
              {t("deleteAllDrafts")}
            </button>
          )}
          <p className="px-2 pb-1 pt-2 text-[11px] leading-relaxed text-on-surface-variant">{t("draftsHint")}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
