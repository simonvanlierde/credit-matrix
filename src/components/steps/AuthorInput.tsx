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
  ArrowDown,
  ArrowUp,
  AtSign,
  Check,
  GripVertical,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  PlusCircle,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useShallow } from "zustand/react/shallow";
import { InitialsChip } from "@/components/ui/initials-chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UNDO_WINDOW_MS, UndoBar } from "@/components/ui/undo-bar";
import { type Author, review } from "@/core";
import { MAX_AUTHOR_NAME_LENGTH, MAX_AUTHORS } from "@/core/author";
import { announce } from "@/lib/announce";
import { copyAskLink } from "@/lib/ask-message";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useHydrated } from "@/lib/use-hydrated";
import { useSettled } from "@/lib/use-settled";
import { type Ask, useContributionStore } from "@/store/contribution-store";
import { OrcidLine, useOrcidLine } from "./OrcidLine";
import { detectOrcid } from "./orcid";
import { useAddContributors } from "./use-add-contributors";

// Module constants, not inline literals: dnd-kit memoizes a sensor on its
// options object, and a fresh one each render rebuilds the activators, which
// re-renders every sortable row.
const POINTER_SENSOR = { activationConstraint: { distance: 5 } };
const KEYBOARD_SENSOR = { coordinateGetter: sortableKeyboardCoordinates };

export function AuthorList() {
  const t = useTranslations();
  const {
    activeDraftId,
    authors,
    loadSample,
    moveAuthor,
    applyAskPatch,
    removeAuthor,
    restoreAuthor,
    setSelfId,
    setTitle,
    title,
    welcomeOpen,
    welcomeSeen,
  } = useContributionStore(
    // Only what this list renders: a whole-store subscription re-rendered it
    // (and every row) on writes it never shows, such as an ask being recorded.
    useShallow((s) => ({
      activeDraftId: s.activeDraftId,
      authors: s.authors,
      loadSample: s.loadSample,
      moveAuthor: s.moveAuthor,
      applyAskPatch: s.applyAskPatch,
      removeAuthor: s.removeAuthor,
      restoreAuthor: s.restoreAuthor,
      setSelfId: s.setSelfId,
      setTitle: s.setTitle,
      title: s.title,
      welcomeOpen: s.welcomeOpen,
      welcomeSeen: s.welcomeSeen,
    })),
  );

  // Stable while the order is: a fresh array each render changes the sortable
  // context and re-renders every row straight through their memo.
  const authorIds = useContributionStore(useShallow((s) => s.authors.map((a) => a.id)));
  const workspaceCleared = useContributionStore((s) => s.workspaceCleared);
  const { locked } = useClaimLock();
  const hydrated = useHydrated();
  // Edited locally, committed on blur — like the contributor name fields. A
  // per-keystroke store write would re-render the grid and statement panes and
  // re-serialize every parked draft to localStorage on each character.
  const [titleDraft, setTitleDraft] = useState(title);
  // External writers (hydration, draft switch, DOI import) own the field when
  // it is not being edited.
  useEffect(() => setTitleDraft(title), [title]);
  const [collapsed, setCollapsed] = useState(false);
  const { newName, setNewName, addError, setAddError, handleAdd, handleAddPaste } = useAddContributors();
  const [removed, setRemoved] = useState<{
    author: Author;
    index: number;
    ask?: Ask;
    wasSelf: boolean;
  } | null>(null);
  const [focusAfterRemove, setFocusAfterRemove] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  // Rows that arrive after the app has settled animate in; a restored draft does not.
  const settled = useSettled();

  // A screen-reader user still hearing the removal announcement could lose a
  // short Undo mid-route, hence the long window.
  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [removed]);

  // The undo buffer belongs to the draft the row was removed from: restoring
  // it after a switch would insert one paper's contributor into another, and
  // after Reset or Delete all it would bring back cleared work.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs on draft switch and clear by design
  useEffect(() => setRemoved(null), [activeDraftId, workspaceCleared]);

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
      // Removing a contributor drops their open ask and their "This is me"
      // mark; undo brings both back.
      const { asks, selfId } = useContributionStore.getState();
      removeAuthor(author.id);
      // No announce() here: the undo bar below mounts as role="status" with the
      // same fact, and saying it twice reads as an echo.
      setRemoved({ author, index, ask: asks[author.id], wasSelf: selfId === author.id });
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
    // the contributor came back when they did not would be a lie. It also
    // no-ops when they are already back (the grid's Undo restored the whole
    // roster), and then there is nothing to report.
    if (restoreAuthor(removed.author, removed.index)) {
      if (removed.ask) applyAskPatch(activeDraftId, { rows: {}, asks: { [removed.author.id]: removed.ask } });
      if (removed.wasSelf) setSelfId(removed.author.id);
      announce(t("annContributorRestored", { name: removed.author.name }));
    } else if (!useContributionStore.getState().authors.some((a) => a.id === removed.author.id)) {
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

  function handleNewNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void handleAdd();
  }

  const header = (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2
        className={`text-xs font-semibold uppercase tracking-wider text-on-surface-variant ${collapsed ? "xl:sr-only" : ""}`}
      >
        {t("stepContributors")}
        {authors.length > 0 && <span className="font-normal"> · {authors.length}</span>}
      </h2>
      {/* The rail folds away on a desktop only; stacked, it is a section like any other. */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("expandContributors") : t("collapseContributors")}
        title={collapsed ? t("expandContributors") : t("collapseContributors")}
        className="hidden size-7 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary xl:flex"
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4" aria-hidden="true" />
        ) : (
          <PanelLeftClose className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );

  const full = (
    <div className="flex flex-col p-3 md:p-4 xl:w-[18rem] xl:p-3 desk:h-full desk:overflow-y-auto">
      {header}

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

  if (!collapsed) return full;
  return (
    <>
      {/* Collapsed: initials only, on a desktop. Narrower windows ignore the
          fold and show the full list, since the rail is not beside anything. */}
      <div className="hidden flex-col items-center p-2 xl:flex desk:h-full desk:overflow-y-auto">
        {header}
        <ul className="flex flex-col items-center gap-1.5">
          {authors.map((author) => (
            <li key={author.id}>
              <InitialsChip author={author} />
              <span className="sr-only">{author.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="xl:hidden">{full}</div>
    </>
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
  isSelf,
  onToggleSelf,
  onToggleEqual,
  onToggleCorresponding,
  onAsk,
  onAddOrcid,
  onMoveUp,
  onMoveDown,
}: {
  name: string;
  equalContribution: boolean;
  corresponding: boolean;
  canAddOrcid: boolean;
  /** Which ask link was just copied, if any. */
  askCopied: "blank" | "prefilled" | null;
  /** Asking someone else to fill a draft you are answering is nonsense. */
  allowAsk: boolean;
  /** This row is the person using the app; absent where that cannot be set. */
  isSelf?: boolean;
  onToggleSelf?: () => void;
  onToggleEqual: () => void;
  onToggleCorresponding: () => void;
  onAsk: (blank: boolean) => void;
  onAddOrcid: () => void;
  /** Absent at the top (or bottom) of the list. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  // Set only by "Add ORCID iD": that path reveals an auto-focused field the
  // trigger-refocus would blur (and its blur handler dismisses it). Every
  // other close should return focus to the trigger as normal.
  const openedOrcidRef = useRef(false);

  const item =
    "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-disabled:cursor-not-allowed aria-disabled:text-on-surface-variant/50 aria-disabled:hover:bg-transparent";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("contributorActions", { name })}
          title={t("contributorActions", { name })}
          className="touch-target inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
        {/* Author order is credit, and dragging is not something every pointer
            can do (WCAG 2.5.7). The menu stays open, so a row can move several
            places in a row. */}
        {(onMoveUp || onMoveDown) && (
          <div className="mb-1 border-b border-outline-variant/40 pb-1">
            <button type="button" onClick={onMoveUp} aria-disabled={!onMoveUp || undefined} className={item}>
              <ArrowUp className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
              {t("moveUp")}
            </button>
            <button type="button" onClick={onMoveDown} aria-disabled={!onMoveDown || undefined} className={item}>
              <ArrowDown className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
              {t("moveDown")}
            </button>
          </div>
        )}
        {onToggleSelf && (
          <button type="button" onClick={onToggleSelf} aria-pressed={isSelf} className={item}>
            <UserRound className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
            {isSelf ? t("thisIsNotMe") : t("thisIsMe")}
          </button>
        )}
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
  const { author, updateAuthorName, setAuthorType, setAuthorMarker } = useContributionStore(
    useShallow((s) => ({
      author: s.authors[index],
      updateAuthorName: s.updateAuthorName,
      setAuthorType: s.setAuthorType,
      setAuthorMarker: s.setAuthorMarker,
    })),
  );
  const { locked, editableAuthorId } = useClaimLock();
  const isClaimed = author !== undefined && author.id === editableAuthorId;
  const rowLocked = locked && !isClaimed;
  const isSelf = useContributionStore((s) => author !== undefined && s.selfId === author.id);
  const setSelfId = useContributionStore((s) => s.setSelfId);
  const moveAuthor = useContributionStore((s) => s.moveAuthor);
  const rowCount = useContributionStore((s) => s.authors.length);
  // Down once their answer is in, up again on a re-ask.
  const asked = useContributionStore(
    (s) => author !== undefined && review(author, s.asks[author.id]).status.kind === "asked",
  );

  function move(by: -1 | 1) {
    if (!author) return;
    moveAuthor(index, index + by);
    announce(t("annMoved", { name: author.name, position: index + by + 1, total: rowCount }));
  }
  const isRecentReply = useContributionStore((s) => s.recentReply !== null && s.recentReply === author?.id);

  const [nameDraft, setNameDraft] = useState(author?.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
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
    // Only a link that actually reached the clipboard counts as an ask.
    await copyAskLink(author, t, blank, (link) => copyAsk(link));
  }

  const nameInputRef = useRef<HTMLInputElement>(null);
  const orcidLine = useOrcidLine(author?.id ?? "", () => nameInputRef.current?.focus());

  // Keyed on the stored name, not the author object: normalizeAuthors rebuilds
  // every author on any list mutation, so an identity-keyed effect overwrote
  // whatever the user was typing whenever an unrelated ORCID lookup resolved.
  // Text typed into the focused field but not yet committed also wins over a
  // name that lands meanwhile, such as this row's own lookup; blur commits it.
  const storedName = author?.name;
  const previousStoredName = useRef(storedName);
  useEffect(() => {
    const previous = previousStoredName.current;
    previousStoredName.current = storedName;
    if (storedName === undefined) return;
    const typing = document.activeElement === nameInputRef.current;
    setNameDraft((draft) => (typing && draft !== previous ? draft : storedName));
  }, [storedName]);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: author?.id ?? index,
  });

  if (!author) return null;

  const authorId = author.id;
  const hasOrcid = (author.orcid ?? "").length > 0;
  const isNonAuthor = author.contributorType === "non-author";

  function handleSmartPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    if (rowLocked) return;
    const orcid = detectOrcid(event.clipboardData.getData("text"));
    if (!orcid) return;
    event.preventDefault();
    orcidLine.applyOrcid(orcid);
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
                // Revert without blurring, as the title field does: blur()
                // commits before the revert renders, saving the abandoned text.
                if (event.key === "Escape") {
                  setNameDraft(author.name);
                  setNameError(null);
                }
              }}
              onPaste={handleSmartPaste}
              aria-invalid={nameError !== null}
              aria-describedby={nameError ? `author-name-error-${author.id}` : undefined}
              className="min-h-6 w-full text-ellipsis bg-transparent border-none p-0 focus:ring-0 text-on-surface font-medium border-b border-primary/20 focus:border-primary outline-none text-sm"
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
                className="inline-flex min-h-6 items-center gap-1 rounded-full bg-surface-container px-2 text-[11px] font-medium text-on-surface-variant hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isNonAuthor ? <UserMinus className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                {isNonAuthor ? t("contributorTypeNonAuthor") : t("contributorTypeAuthor")}
              </button>
              {isSelf && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {t("teamYou")}
                </span>
              )}
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
                  canAddOrcid={!hasOrcid && !orcidLine.editingOrcid}
                  askCopied={askCopied}
                  allowAsk={!(locked || isSelf)}
                  isSelf={isSelf}
                  onToggleSelf={locked ? undefined : () => setSelfId(isSelf ? null : author.id)}
                  onToggleEqual={() => setAuthorMarker(author.id, "equalContribution", !author.equalContribution)}
                  onToggleCorresponding={() => setAuthorMarker(author.id, "corresponding", !author.corresponding)}
                  onAsk={(blank) => void handleAsk(blank)}
                  onAddOrcid={() => orcidLine.setEditingOrcid(true)}
                  onMoveUp={!locked && index > 0 ? () => move(-1) : undefined}
                  onMoveDown={!locked && index < rowCount - 1 ? () => move(1) : undefined}
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

        <OrcidLine author={author} rowLocked={rowLocked} line={orcidLine} onPaste={handleSmartPaste} />
      </div>
    </li>
  );
});
