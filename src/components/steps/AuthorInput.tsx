"use client";

import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AtSign,
  Check,
  Fingerprint,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  PlusCircle,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  UserSearch,
  Users,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useShallow } from "zustand/react/shallow";
import { InitialsChip } from "@/components/ui/initials-chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StepHeader } from "@/components/ui/step-header";
import { UndoBar } from "@/components/ui/undo-bar";
import {
  type Author,
  hasContributions,
  isValidOrcid,
  lookupOrcidPerson,
  MAX_AUTHOR_NAME_LENGTH,
  MAX_AUTHORS,
  normalizeOrcid,
  ORCID_REGEX,
  splitNameList,
} from "@/core";
import { announce } from "@/lib/announce";
import { buildShareUrl, shareFailureKey } from "@/lib/share";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useHydrated } from "@/lib/use-hydrated";
import { useSettled } from "@/lib/use-settled";
import { type Ask, useContributionStore } from "@/store/contribution-store";

// Module constants, not inline literals: dnd-kit memoizes a sensor on its
// options object, and a fresh one each render rebuilds the activators, which
// re-renders every sortable row.
const POINTER_SENSOR = { activationConstraint: { distance: 5 } };
const KEYBOARD_SENSOR = { coordinateGetter: sortableKeyboardCoordinates };

const ORCID_EXTRACT_REGEX = /(\d{4}-\d{4}-\d{4}-\d{3}[0-9X])/i;

/** Pull a valid ORCID iD out of arbitrary text (a raw id or an orcid.org URL). */
function detectOrcid(text: string): string | null {
  const candidate = text.trim().match(ORCID_EXTRACT_REGEX)?.[1]?.toUpperCase() ?? "";
  return ORCID_REGEX.test(candidate) ? candidate : null;
}

/**
 * Resolve an ORCID iD to a display name, straight from ORCID's public API
 * (it sends `Access-Control-Allow-Origin: *`).
 *
 * Returns a failure *code*, not a message: this runs outside React, so it
 * cannot translate. The caller holds `t` and renders the code.
 */
type OrcidFailure = { code: keyof typeof ORCID_ERROR_KEYS };

async function fetchOrcidName(orcid: string): Promise<{ displayName: string } | OrcidFailure> {
  // The lookup is the one part of the app that needs a network; say so
  // rather than blaming ORCID.
  if (!navigator.onLine) return { code: "OFFLINE" };
  const result = await lookupOrcidPerson(normalizeOrcid(orcid));
  if (!result.ok) {
    // A connection that drops mid-request fails as UNAVAILABLE; say offline.
    return { code: result.code === "UNAVAILABLE" && !navigator.onLine ? "OFFLINE" : result.code };
  }
  return { displayName: result.displayName };
}

/**
 * Failure code → message key. Explicit rather than built by string
 * concatenation, so the typed-message guarantee still holds: a key removed
 * from en.json breaks the build here instead of silently rendering a key name.
 */
const ORCID_ERROR_KEYS = {
  INVALID_ID: "errOrcidINVALID_ID",
  NOT_FOUND: "errOrcidNOT_FOUND",
  UNAVAILABLE: "errOrcidUNAVAILABLE",
  OFFLINE: "errOffline",
} as const;

/** Render an ORCID failure in the interface language. */
function orcidErrorText(failure: OrcidFailure, t: ReturnType<typeof useTranslations>): string {
  return t(ORCID_ERROR_KEYS[failure.code]);
}

// NOTE: a courtesy cap on concurrent ORCID lookups, not app correctness — a
// plain Promise.all would work; keep the cap so a 100-iD paste doesn't hammer
// the registry from one browser.
async function forEachWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) await task(item);
    }
  });
  await Promise.all(workers);
}

export function AuthorList() {
  const t = useTranslations();
  const format = useFormatter();
  const {
    activeDraftId,
    authors,
    addAuthor,
    loadSample,
    moveAuthor,
    markAsked,
    removeAuthor,
    restoreAuthor,
    setTitle,
    title,
    updateAuthorName,
    welcomeOpen,
    welcomeSeen,
  } = useContributionStore(
    // Only what this list renders: a whole-store subscription re-rendered it
    // (and every row) on writes it never shows, such as an ask being recorded.
    useShallow((s) => ({
      activeDraftId: s.activeDraftId,
      authors: s.authors,
      addAuthor: s.addAuthor,
      loadSample: s.loadSample,
      moveAuthor: s.moveAuthor,
      markAsked: s.markAsked,
      removeAuthor: s.removeAuthor,
      restoreAuthor: s.restoreAuthor,
      setTitle: s.setTitle,
      title: s.title,
      updateAuthorName: s.updateAuthorName,
      welcomeOpen: s.welcomeOpen,
      welcomeSeen: s.welcomeSeen,
    })),
  );

  // Stable while the order is: a fresh array each render changes the sortable
  // context and re-renders every row straight through their memo.
  const authorIds = useContributionStore(useShallow((s) => s.authors.map((a) => a.id)));
  const { locked } = useClaimLock();
  const hydrated = useHydrated();
  // Edited locally, committed on blur — like the contributor name fields. A
  // per-keystroke store write would re-render the grid and statement panes and
  // re-serialize every parked draft to localStorage on each character.
  const [titleDraft, setTitleDraft] = useState(title);
  // External writers (hydration, draft switch, DOI import) own the field when
  // it is not being edited.
  useEffect(() => setTitleDraft(title), [title]);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ author: Author; index: number; ask?: Ask } | null>(null);
  const [focusAfterRemove, setFocusAfterRemove] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  // Rows that arrive after the app has settled animate in; a restored draft does not.
  const settled = useSettled();

  // A long window on purpose: eight seconds was under WCAG 2.2.1's threshold,
  // and a screen-reader user still hearing the removal announcement could
  // lose the Undo mid-route.
  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), 60000);
    return () => window.clearTimeout(timer);
  }, [removed]);

  // The undo buffer belongs to the draft the row was removed from: restoring
  // it after a switch would insert one paper's contributor into another.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs on draft switch by design
  useEffect(() => setRemoved(null), [activeDraftId]);

  // Runs after the removed row has left the DOM, so the buttons queried here
  // are the surviving ones. Falls back to the add field when the list empties.
  useEffect(() => {
    if (focusAfterRemove === null) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove-author]");
    const target = buttons?.length ? buttons[Math.min(focusAfterRemove, buttons.length - 1)] : undefined;
    (target ?? addInputRef.current)?.focus();
    setFocusAfterRemove(null);
  }, [focusAfterRemove]);

  // Stable, so a memoized AuthorRow is not re-rendered by a new callback.
  const handleRemove = useCallback(
    (author: Author, index: number) => {
      // Removing a contributor drops their open ask; undo brings it back.
      const ask = useContributionStore.getState().asks[author.id];
      removeAuthor(author.id);
      // No announce() here: the undo bar below mounts as role="status" with the
      // same fact, and saying it twice reads as an echo.
      setRemoved({ author, index, ask });
      // The button that was just activated is unmounting, which drops focus to
      // <body> and sends a keyboard user back to the top of the document. Hand
      // focus to the row that takes its place instead.
      setFocusAfterRemove(index);
    },
    [removeAuthor],
  );

  function undoRemove() {
    if (!removed) return;
    // restoreAuthor no-ops when the list has refilled to the cap; claiming
    // the contributor came back when they did not would be a lie.
    if (restoreAuthor(removed.author, removed.index)) {
      if (removed.ask) markAsked(removed.author.id, removed.ask);
      announce(t("annContributorRestored", { name: removed.author.name }));
    } else {
      announce(t("errAtContributorLimit", { limit: MAX_AUTHORS }), { assertive: true });
    }
    setRemoved(null);
  }

  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR), useSensor(KeyboardSensor, KEYBOARD_SENSOR));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = authors.findIndex((a) => a.id === active.id);
    const to = authors.findIndex((a) => a.id === over.id);
    if (from !== -1 && to !== -1) moveAuthor(from, to);
  }

  // Announce reorder by contributor name; @dnd-kit's default announcements key
  // off the opaque author id, which reads as meaningless to a screen reader.
  const nameForId = (id: UniqueIdentifier) => authors.find((a) => a.id === id)?.name || t("contributorColumn");
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dndPickedUp", { name: nameForId(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("dndOver", { name: nameForId(active.id), target: nameForId(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("dndDropped", { name: nameForId(active.id), target: nameForId(over.id) })
        : t("dndCancelled", { name: nameForId(active.id) }),
    onDragCancel: ({ active }) => t("dndCancelled", { name: nameForId(active.id) }),
  };

  /** Seed a row from an ORCID iD, then fill its name from the registry. */
  async function addOrcidAuthor(orcid: string): Promise<{ id: string | null; error: string | null }> {
    const id = addAuthor(orcid, orcid);
    if (!id) return { id, error: null };
    const result = await fetchOrcidName(orcid);
    if ("code" in result) return { id, error: orcidErrorText(result, t) };
    // A refused write (the row went with a draft switch mid-lookup) leaves the
    // row named after its iD, so it is a failure, not a success.
    if (!updateAuthorName(id, result.displayName)) {
      return { id, error: t("annOrcidLookupsFailed", { count: 1, ids: orcid }) };
    }
    return { id, error: null };
  }

  /**
   * Add several contributors at once. Every row lands immediately, in the pasted
   * order; ORCID names then fill in from concurrent lookups.
   */
  async function addMany(tokens: string[]) {
    const pending: { id: string; orcid: string }[] = [];
    const rejected: string[] = [];
    const capacity = Math.max(0, MAX_AUTHORS - authors.length);
    const acceptedTokens = tokens.slice(0, capacity);
    const skippedForLimit = tokens.length - acceptedTokens.length;

    // An iD with the right shape but a bad check digit used to fall through to
    // addAuthor, throw inside createAuthor, and land in `rejected`; reported
    // as "no name in them", which is the wrong diagnosis. The single-add path
    // already checks the checksum, so bucket it the same way here.
    const badChecksum: string[] = [];
    for (const token of acceptedTokens) {
      const orcid = detectOrcid(token);
      if (orcid && !isValidOrcid(orcid)) {
        badChecksum.push(orcid);
        continue;
      }
      const id = addAuthor(orcid ?? token, orcid ?? undefined);
      if (!id) rejected.push(token);
      else if (orcid) pending.push({ id, orcid });
    }

    // Keep the row on a failed lookup (named after its iD) so one bad token
    // doesn't silently vanish from a pasted list, but say which ones failed,
    // so the rows still named after an iD aren't mistaken for real names.
    const failed: string[] = [];
    await forEachWithConcurrency(pending, 4, async ({ id, orcid }) => {
      const result = await fetchOrcidName(orcid);
      // A refused write leaves the row named after its iD, same as a failed lookup.
      if ("code" in result || !updateAuthorName(id, result.displayName)) failed.push(orcid);
    });

    const addedCount = acceptedTokens.length - rejected.length - badChecksum.length;
    const added = t("annContributorsAdded", { count: addedCount });
    // The UI locale's own list punctuation: "、" in Japanese, not ", ".
    const list = (items: string[]) => format.list(items, { type: "conjunction" });
    const problems = [
      rejected.length > 0 && t("annEntriesSkippedNoName", { count: rejected.length, entries: list(rejected) }),
      badChecksum.length > 0 && t("annOrcidChecksumsSkipped", { count: badChecksum.length, ids: list(badChecksum) }),
      failed.length > 0 && t("annOrcidLookupsFailed", { count: failed.length, ids: list(failed) }),
      skippedForLimit > 0 && t("annContributorsSkippedLimit", { count: skippedForLimit, limit: MAX_AUTHORS }),
    ].filter(Boolean);

    if (problems.length === 0) {
      announce(added);
      return;
    }
    const message = problems.join(" ");
    setAddError(message);
    announce(`${added} ${message}`, { assertive: true });
  }

  /** Add from the input: a bare ORCID seeds the row then fills its name from ORCID. */
  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAddError(null);
    // addAuthor returns null both for an unparseable name and for a full list,
    // so check the cap here. Without it, adding at the limit either reported
    // "that doesn't look like a name" (false) or, for an ORCID, cleared the
    // input and silently did nothing. addMany already reports this separately.
    if (authors.length >= MAX_AUTHORS) {
      const message = t("errAtContributorLimit", { limit: MAX_AUTHORS });
      setAddError(message);
      announce(message, { assertive: true });
      return;
    }
    const tokens = splitNameList(trimmed);
    if (tokens.length > 1) {
      setNewName("");
      await addMany(tokens);
      return;
    }
    const orcid = detectOrcid(trimmed);
    if (orcid) {
      if (!isValidOrcid(orcid)) {
        setAddError(t("errOrcidChecksum"));
        announce(t("errOrcidChecksum"), { assertive: true });
        return;
      }
      setNewName("");
      const { id, error } = await addOrcidAuthor(orcid);
      if (error) {
        // No junk author named after the iD survives a failed lookup, but a row
        // the user renamed or gave roles while waiting is theirs, not junk.
        // Read from the store: `authors` here is the list from before the await.
        const row = useContributionStore.getState().authors.find((a) => a.id === id);
        if (row && row.name === orcid && !hasContributions(row)) removeAuthor(row.id);
        setAddError(error);
        announce(error, { assertive: true });
        // Hand the iD back only to an empty field, not over the next name typed.
        setNewName((current) => (current.trim() ? current : orcid));
      }
    } else if (addAuthor(trimmed)) {
      setNewName("");
    } else {
      setAddError(t("errNameNoLetter"));
    }
  }

  function handleNewNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void handleAdd();
  }

  /** Pasting a whole author list adds every name; single names paste normally. */
  function handleAddPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const tokens = splitNameList(event.clipboardData.getData("text"));
    if (tokens.length <= 1) return;
    event.preventDefault();
    setAddError(null);
    void addMany(tokens);
  }

  return (
    <div className="flex flex-col bg-surface-bright rounded-lg shadow-sm border border-outline-variant/20 p-3 md:p-4 desk:h-full desk:overflow-y-auto">
      <StepHeader n={1} title={t("stepContributors")} className="mb-3" />

      {locked && (
        <p className="mb-3 rounded-lg bg-primary/5 px-3 py-2 text-xs text-on-surface-variant">{t("claimLockedHint")}</p>
      )}

      {/* The work's title. Quiet by design — it is optional, it names the draft
          in the picker, and a DOI import fills it in. */}
      <label htmlFor="work-title" className="sr-only">
        {t("draftTitleLabel")}
      </label>
      {/* The pencil is the editability hint: without it the borderless field
          reads as static gray text and nobody discovers drafts can be named.
          pointer-events-none, so a click on it lands in the input. */}
      <div className="relative mb-3">
        <input
          id="work-title"
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => setTitle(titleDraft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            // Revert without blurring: blur() fires before the revert renders,
            // so a blur here would commit the abandoned text.
            if (event.key === "Escape") setTitleDraft(title);
          }}
          // Read-only until the persisted draft lands, because anything typed
          // before that is silently overwritten by it.
          readOnly={!hydrated}
          placeholder={t("untitledDraft")}
          className="peer w-full border-b border-outline-variant/30 bg-transparent pb-1 pr-6 text-sm font-medium text-on-surface outline-none transition-colors placeholder:font-normal placeholder:text-on-surface-variant/60 focus:border-primary"
        />
        <Pencil
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-1 h-3.5 w-3.5 text-on-surface-variant/60 transition-opacity peer-focus:opacity-0"
        />
      </div>

      {authors.length === 0 && !welcomeOpen && (
        <div className="rounded-lg border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-6 text-center">
          <UserPlus className="h-8 w-8 text-outline-variant mb-2 mx-auto" />
          <p className="text-sm text-on-surface-variant">
            {t("noContributorsYet")} {t.rich("noContributorsHint", { b: (chunks) => <strong>{chunks}</strong> })}
          </p>
          {/* Only for returning/dismissed users (welcomeSeen) with the card closed:
              on a first run the welcome card owns this action, so the button is never
              duplicated and never flashes during hydration before the card opens. */}
          {welcomeSeen && !welcomeOpen && !locked && (
            <button
              type="button"
              onClick={() => loadSample(t("sampleNames").split("\n"))}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary hover:text-on-primary hover:border-primary transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {t("loadSample")}
            </button>
          )}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{ announcements }}
      >
        <SortableContext items={authorIds} strategy={verticalListSortingStrategy}>
          {/* A real list, so assistive tech announces the item count and each
              row's position; the ordering a sighted user reads straight off
              the layout. Tailwind's preflight already strips the markers. */}
          <ul ref={listRef} className="space-y-1 desk:min-h-0 desk:flex-1 desk:overflow-y-auto">
            {authors.map((author, index) => (
              <AuthorRow key={author.id} index={index} onRemove={handleRemove} enter={settled} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {removed && (
        <UndoBar
          message={t("removedContributor", { name: removed.author.name })}
          onUndo={undoRemove}
          className="mt-3"
        />
      )}

      {addError !== null && <p className="mt-4 -mb-2 text-xs text-error">{addError}</p>}

      {!locked && (
        <div className="mt-3 flex gap-2 items-center">
          <input
            ref={addInputRef}
            type="text"
            maxLength={MAX_AUTHOR_NAME_LENGTH}
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
              if (addError !== null) setAddError(null);
            }}
            onKeyDown={handleNewNameKeyDown}
            onPaste={handleAddPaste}
            readOnly={!hydrated}
            placeholder={t("addPlaceholder")}
            aria-label={t("addContributor")}
            className="flex-1 min-w-0 text-ellipsis bg-surface-container-low border-b-2 border-outline-variant/40 focus:border-primary focus:ring-0 outline-none px-3 py-2 text-sm rounded-t text-on-surface placeholder-outline transition-colors"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!newName.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary hover:text-on-primary hover:bg-primary border border-primary/30 hover:border-primary rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PlusCircle className="h-4 w-4" />
            {t("addButton")}
          </button>
        </div>
      )}

      {/* No footer note: the Drafts menu already says drafts stay in this
          browser, right where deleting them lives. */}
    </div>
  );
}

/** A set authorship marker, shown as a fact about the paper rather than a control. */
function MarkerChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      {icon}
      {label}
    </span>
  );
}

/**
 * The per-contributor actions, behind one disclosure.
 *
 * Inline, these were five chips on every row: on a phone that is three lines
 * per contributor, and this pane is where vertical space is worth most. Behind
 * a menu they also stop depending on hover, which a tablet does not have.
 */
function RowMenu({
  name,
  equalContribution,
  corresponding,
  canAddOrcid,
  askCopied,
  allowAsk,
  onToggleEqual,
  onToggleCorresponding,
  onAsk,
  onAddOrcid,
}: {
  name: string;
  equalContribution: boolean;
  corresponding: boolean;
  canAddOrcid: boolean;
  /** Which ask link was just copied, if any. */
  askCopied: "blank" | "prefilled" | null;
  /** Asking someone else to fill a draft you are answering is nonsense. */
  allowAsk: boolean;
  onToggleEqual: () => void;
  onToggleCorresponding: () => void;
  onAsk: (blank: boolean) => void;
  onAddOrcid: () => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  // Set only by "Add ORCID iD": that path reveals an auto-focused field the
  // trigger-refocus would blur (and its blur handler dismisses it). Every
  // other close should return focus to the trigger as normal.
  const openedOrcidRef = useRef(false);

  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("contributorActions", { name })}
          title={t("contributorActions", { name })}
          className="touch-target inline-flex items-center rounded-full px-1.5 py-0.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onCloseAutoFocus={(event) => {
          if (!openedOrcidRef.current) return;
          openedOrcidRef.current = false;
          event.preventDefault();
        }}
        className="w-60 p-1"
      >
        <button type="button" onClick={onToggleEqual} aria-pressed={equalContribution} className={item}>
          <Users className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
          {equalContribution ? t("equalContributionUnset") : t("equalContributionSet")}
        </button>
        <button type="button" onClick={onToggleCorresponding} aria-pressed={corresponding} className={item}>
          <AtSign className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
          {corresponding ? t("correspondingUnset") : t("correspondingSet")}
        </button>
        {allowAsk && (
          <div className="my-1 border-y border-outline-variant/40 py-1">
            {(["blank", "prefilled"] as const).map((kind) => (
              <button key={kind} type="button" onClick={() => onAsk(kind === "blank")} className={item}>
                {askCopied === kind ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <Send className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
                )}
                {askCopied === kind
                  ? t("askCopied")
                  : kind === "blank"
                    ? t("askBlank", { name })
                    : t("askPrefilled", { name })}
              </button>
            ))}
            <p className="px-2 pt-0.5 pb-1 text-[11px] leading-snug text-on-surface-variant">{t("askLinkHint")}</p>
          </div>
        )}
        {canAddOrcid && (
          <button
            type="button"
            onClick={() => {
              openedOrcidRef.current = true;
              onAddOrcid();
              setOpen(false);
            }}
            className={item}
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
            {t("addOrcid")}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Memoized, and subscribed to its own contributor only: immer keeps an
 * untouched author object identical, so an edit to one row (or one grid cell)
 * re-renders that row, not all of them.
 */
const AuthorRow = memo(function AuthorRowInner({
  index,
  onRemove,
  enter,
}: {
  index: number;
  onRemove: (author: Author, index: number) => void;
  enter: boolean;
}) {
  const t = useTranslations();
  const { author, updateAuthorName, updateAuthorOrcid, setAuthorType, setAuthorMarker } = useContributionStore(
    useShallow((s) => ({
      author: s.authors[index],
      updateAuthorName: s.updateAuthorName,
      updateAuthorOrcid: s.updateAuthorOrcid,
      setAuthorType: s.setAuthorType,
      setAuthorMarker: s.setAuthorMarker,
    })),
  );
  const { locked, editableAuthorId } = useClaimLock();
  const isClaimed = author !== undefined && author.id === editableAuthorId;
  const rowLocked = locked && !isClaimed;
  const markAsked = useContributionStore((s) => s.markAsked);
  const asked = useContributionStore((s) => author !== undefined && author.id in s.asks);
  const isRecentReply = useContributionStore((s) => s.recentReply !== null && s.recentReply === author?.id);

  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookedUp, setLookedUp] = useState<string | null>(null);
  // Revealed-but-empty ORCID input, and a guard so an Enter-commit's unmount
  // blur doesn't re-apply the iD.
  const [editingOrcid, setEditingOrcid] = useState(false);
  const [nameDraft, setNameDraft] = useState(author?.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const committedRef = useRef(false);
  // Same status/announce/reset contract as every other copy affordance.
  const [askStatus, copyAsk] = useCopyStatus({
    copied: t("askContributorCopied", { name: author?.name ?? "" }),
  });
  const [askKind, setAskKind] = useState<"blank" | "prefilled">("blank");
  const askCopied = askStatus === "copied" ? askKind : null;

  /**
   * Copy a link addressed at this contributor. They open it, tick their own
   * roles, and send the same link back; importing it collects that row alone.
   * A blank ask sends their row empty, so the answer is their own account
   * rather than a check of your guess.
   */
  async function handleAsk(blank: boolean) {
    if (!author) return;
    setAskKind(blank ? "blank" : "prefilled");
    const sentAt = Date.now();
    let url: string;
    try {
      // Read at click time: the link carries the title, which this row does
      // not subscribe to.
      const { authors, title, activeDraftId } = useContributionStore.getState();
      url = await buildShareUrl({ authors, title, claimId: author.id, sourceDraftId: activeDraftId, blank, sentAt });
    } catch {
      announce(t(shareFailureKey()), { assertive: true });
      return;
    }
    // Only a link that actually reached the clipboard counts as an ask.
    if (await copyAsk(url)) markAsked(author.id, { sentAt, prefilled: !blank });
  }

  const nameInputRef = useRef<HTMLInputElement>(null);
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

  // Keyed on the stored name, not the author object: normalizeAuthors rebuilds
  // every author on any list mutation, so an identity-keyed effect overwrote
  // whatever the user was typing whenever an unrelated ORCID lookup resolved.
  const storedName = author?.name;
  useEffect(() => {
    if (storedName !== undefined) setNameDraft(storedName);
  }, [storedName]);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: author?.id ?? index,
  });

  // Transient ORCID status (success or error) clears itself after a few seconds.
  useEffect(() => {
    if (lookedUp === null && lookupError === null) return;
    const timer = setTimeout(() => {
      setLookedUp(null);
      setLookupError(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [lookedUp, lookupError]);

  if (!author) return null;

  const authorId = author.id;
  const orcidValue = author.orcid ?? "";
  const bareOrcid = normalizeOrcid(orcidValue);
  const hasOrcid = orcidValue.length > 0;
  const orcidValid = isValidOrcid(orcidValue);
  const isNonAuthor = author.contributorType === "non-author";

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

  /** Returns true when the iD was accepted and the editor closed. */
  function applyOrcid(orcid: string): boolean {
    if (!isValidOrcid(orcid)) {
      setLookupError(t("errOrcidChecksum"));
      announce(t("errOrcidChecksum"), { assertive: true });
      setEditingOrcid(true);
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
    nameInputRef.current?.focus();
  }

  function handleSmartPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    if (rowLocked) return;
    const orcid = detectOrcid(event.clipboardData.getData("text"));
    if (!orcid) return;
    event.preventDefault();
    applyOrcid(orcid);
  }

  function commitName() {
    if (rowLocked) return;
    // A long name leaves the input scrolled to its tail. Rewind it so the
    // truncation reads from the start ("Maximiliana Feathersto…") the moment
    // the field is left, rather than whenever the row next re-renders.
    nameInputRef.current?.scrollTo({ left: 0 });
    if (updateAuthorName(authorId, nameDraft)) {
      setNameError(null);
      return;
    }
    // `updateAuthorName` refuses both an over-long name and one with no letter
    // in it. Name the rule the input actually broke, rather than reciting both.
    const trimmed = nameDraft.trim();
    setNameError(trimmed.length > MAX_AUTHOR_NAME_LENGTH ? t("errNameTooLong") : t("errNameNoLetter"));
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // The row a claimed link asks for. The banner names the person, but in a
      // twelve-author list that still leaves them hunting, so the row says so
      // itself — tint, rule, and a worded badge, never colour alone.
      aria-current={isClaimed ? "true" : undefined}
      className={`group rounded-lg border px-2 py-0.5 transition-colors duration-150 ${
        isClaimed || isRecentReply
          ? "border-primary/40 bg-primary/5"
          : "border-transparent hover:border-outline-variant/30 hover:bg-surface-container-low"
      } ${isDragging ? "relative z-10 bg-surface shadow-md" : ""}`}
    >
      {/* The entrance lives on this wrapper, not on the row: @dnd-kit owns the
          sortable node's inline transform and transition, and an inline
          transition beats anything a class can say. The stagger is capped so a
          pasted list of thirty names still finishes in a fifth of a second. */}
      <div className={enter ? "enter-rise" : undefined} style={{ transitionDelay: `${Math.min(index, 5) * 40}ms` }}>
        {/* Identity line: everything that is one-per-contributor and short. */}
        <div className="flex items-center gap-2">
          {locked ? (
            // Placeholder, not a disabled handle: the list order is frozen for
            // everyone while a claim is open, and the row still has to line up.
            <span className="size-6 shrink-0" aria-hidden="true" />
          ) : (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`${t("reorderContributor")} ${author.name}`}
              className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-outline-variant transition-colors hover:text-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}

          <InitialsChip author={author} />

          <div className="flex-1 min-w-0">
            <input
              ref={nameInputRef}
              id={`author-name-${author.id}`}
              type="text"
              maxLength={MAX_AUTHOR_NAME_LENGTH}
              aria-label={t("nameLabel")}
              value={nameDraft}
              onChange={(event) => {
                setNameDraft(event.target.value);
                setNameError(null);
              }}
              readOnly={rowLocked}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setNameDraft(author.name);
                  setNameError(null);
                  event.currentTarget.blur();
                }
              }}
              onPaste={handleSmartPaste}
              aria-invalid={nameError !== null}
              aria-describedby={nameError ? `author-name-error-${author.id}` : undefined}
              className="w-full text-ellipsis bg-transparent border-none p-0 focus:ring-0 text-on-surface font-medium border-b border-primary/20 focus:border-primary outline-none text-sm"
            />
            {nameError && (
              <span id={`author-name-error-${author.id}`} className="mt-1 block text-[11px] text-error">
                {nameError}
              </span>
            )}

            {/* Type badge, plus the ORCID trigger while there is nothing to show. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* The changing visible name carries the state; aria-pressed on
                  top of it double-encoded the same fact inverted ("Author,
                  pressed" when they are not one). */}
              <button
                type="button"
                onClick={() => setAuthorType(author.id, isNonAuthor ? "author" : "non-author")}
                disabled={rowLocked}
                title={isNonAuthor ? t("contributorTypeSetAuthor") : t("contributorTypeSetNonAuthor")}
                className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-medium text-on-surface-variant hover:text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isNonAuthor ? <UserMinus className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                {isNonAuthor ? t("contributorTypeNonAuthor") : t("contributorTypeAuthor")}
              </button>
              {isClaimed && (
                // No icon: the neighbouring type chip already carries UserCheck,
                // and two identical glyphs side by side read as a mistake.
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {t("claimedRowBadge")}
                </span>
              )}
              {/* Set markers stay on the row: they say something about the paper,
                  not about what you can do to it. */}
              {author.equalContribution && (
                <MarkerChip icon={<Users className="h-3 w-3" />} label={t("equalContributionShort")} />
              )}
              {author.corresponding && (
                <MarkerChip icon={<AtSign className="h-3 w-3" />} label={t("correspondingShort")} />
              )}
              {/* A reply just landed here: the status strip says so at the
                  top, and this badge says so on the row itself. It leaves
                  with the strip — dismissed, undone, timed out, or replaced —
                  or on a draft switch. */}
              {isRecentReply && (
                <span
                  title={t("mergedRowBadgeTitle")}
                  className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                >
                  {t("mergedRowBadge")}
                </span>
              )}
              {/* An open ask: quiet, because it is a reminder, not a state of
                  the paper. It comes down by itself when the reply merges. */}
              {asked && (
                <span
                  title={t("askedChipTitle")}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-medium text-on-surface-variant"
                >
                  <Send className="h-3 w-3" />
                  {t("askedChip")}
                </span>
              )}
              {/* Everything you can *do* to one contributor lives behind one
                  disclosure. Five inline chips per row cost three lines on a
                  phone, and this pane is where vertical space is worth most. */}
              {!rowLocked && (
                <RowMenu
                  name={author.name}
                  equalContribution={author.equalContribution}
                  corresponding={author.corresponding}
                  canAddOrcid={!hasOrcid && !editingOrcid}
                  askCopied={askCopied}
                  allowAsk={!locked}
                  onToggleEqual={() => setAuthorMarker(author.id, "equalContribution", !author.equalContribution)}
                  onToggleCorresponding={() => setAuthorMarker(author.id, "corresponding", !author.corresponding)}
                  onAsk={(blank) => void handleAsk(blank)}
                  onAddOrcid={() => setEditingOrcid(true)}
                />
              )}
            </div>
          </div>

          {!locked && (
            <button
              type="button"
              data-remove-author=""
              onClick={() => onRemove(author, index)}
              className="touch-target shrink-0 flex items-center justify-center size-8 rounded text-on-surface-variant hover:bg-error-container/30 hover:text-error transition-colors"
              aria-label={`${t("removeContributor")} ${author.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ORCID line. A 19-character iD never fits beside the type badge in this
          column, so it gets a line of its own, indented to the name column so it
          shares a left edge with the type badge above it, and with its actions on
          the same line instead of wrapping into a ragged fourth one. */}
        {(hasOrcid || editingOrcid || lookupError !== null) && (
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
                {!rowLocked && orcidValid && lookedUp !== bareOrcid && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void lookup(bareOrcid)}
                    aria-label={t("lookupOrcidName")}
                    title={t("lookupOrcidName")}
                    className="reveal-on-hover ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-primary transition-opacity hover:underline disabled:opacity-50"
                  >
                    <UserSearch className="h-3.5 w-3.5" />
                    {loading && t("lookingUp")}
                  </button>
                )}
                {!rowLocked && (
                  <button
                    type="button"
                    onClick={clearOrcid}
                    aria-label={t("removeOrcid")}
                    className="ml-auto shrink-0 text-on-surface-variant transition-colors hover:text-error"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {lookedUp === bareOrcid && (
                  <span className="shrink-0 text-[11px] leading-tight text-primary">{t("nameUpdated")}</span>
                )}
              </>
            ) : editingOrcid && !rowLocked ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: revealed on explicit user action, so focusing it is expected.
                autoFocus
                type="text"
                aria-label={t("a11yOrcidInput")}
                placeholder="0000-0000-0000-0000"
                title={t("a11yOrcidHint")}
                onPaste={handleSmartPaste}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const orcid = detectOrcid(event.currentTarget.value);
                  // Only suppress the follow-up blur when the apply actually
                  // took. On a checksum failure the input stays mounted, and a
                  // latched ref made the next blur discard the corrected iD.
                  if (orcid) committedRef.current = applyOrcid(orcid);
                }}
                onBlur={(event) => {
                  if (committedRef.current) {
                    committedRef.current = false;
                    return;
                  }
                  const orcid = detectOrcid(event.currentTarget.value);
                  if (orcid) applyOrcid(orcid);
                  else setEditingOrcid(false);
                }}
                className="w-full min-w-0 border-b border-outline-variant/40 bg-transparent p-0 font-mono text-xs text-on-surface-variant outline-none focus:border-primary focus:ring-0"
              />
            ) : null}
          </div>
        )}
        {lookupError !== null && <p className="mt-1 pl-20 text-[11px] leading-tight text-error">{lookupError}</p>}
      </div>
    </li>
  );
});
