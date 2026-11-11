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
  ChevronDown,
  ChevronUp,
  GripVertical,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PlusCircle,
  Send,
  Sparkles,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { InitialsChip } from "@/components/ui/initials-chip";
import { UNDO_WINDOW_MS, UndoBar } from "@/components/ui/undo-bar";
import { type Author, review } from "@/core";
import { MAX_AUTHOR_NAME_LENGTH, MAX_AUTHORS } from "@/core/author";
import { announce } from "@/lib/announce";
import { useTranslations } from "@/lib/translations";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useHydrated } from "@/lib/use-hydrated";
import { useSettled } from "@/lib/use-settled";
import { type Ask, useContributionStore } from "@/store/contribution-store";
import { OrcidLine, useOrcidLine } from "./OrcidLine";
import { detectOrcid } from "./orcid";
import { PersonMenu } from "./PersonMenu";
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
  // A collapsed rail has no fields: open it for a request to edit one person in the list.
  const listFocusRequested = useContributionStore((s) => s.listFocus !== null);
  useEffect(() => {
    if (listFocusRequested) setCollapsed(false);
  }, [listFocusRequested]);
  const { newName, setNewName, addError, setAddError, handleAdd, handleAddPaste } = useAddContributors();
  const addErrorId = useId();
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
      announce(t("removedContributor", { name: author.name }));
      setRemoved({ author, index, ask: asks[author.id], wasSelf: selfId === author.id });
      // The button that was just activated is unmounting, which drops focus to
      // <body> and sends a keyboard user back to the top of the document. Hand
      // focus to the row that takes its place instead.
      setFocusAfterRemove(index);
    },
    [removeAuthor, t],
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
      <h2 className={`font-headline text-xl font-semibold text-on-surface ${collapsed ? "xl:sr-only" : ""}`}>
        {t("stepContributors")}
        {authors.length > 0 && (
          <>
            {/* The middot is for the accessible name: "Contributors · 3", not "Contributors3". */}
            <span className="sr-only"> · </span>
            <span className="ml-2 font-mono text-[13px] font-normal text-on-surface-variant">{authors.length}</span>
          </>
        )}
      </h2>
      {/* On a desktop the list folds into a rail of initials beside the grid; stacked above it,
          into one row of them, which saves the scroll past a long list. Nothing to fold when empty. */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("expandContributors") : t("collapseContributors")}
        title={collapsed ? t("expandContributors") : t("collapseContributors")}
        className={`hit-area size-7 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          authors.length > 0 ? "flex" : "hidden xl:flex"
        }`}
      >
        {collapsed ? (
          <>
            <PanelLeftOpen className="hidden size-4 xl:block" aria-hidden="true" />
            <ChevronDown className="size-4 xl:hidden" aria-hidden="true" />
          </>
        ) : (
          <>
            <PanelLeftClose className="hidden size-4 xl:block" aria-hidden="true" />
            <ChevronUp className="size-4 xl:hidden" aria-hidden="true" />
          </>
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
          className="peer w-full border-b border-outline-strong bg-transparent pb-1 pr-6 text-sm font-medium text-on-surface outline-none transition-colors placeholder:font-normal placeholder:text-on-surface-variant focus:border-primary"
        />
        <Pencil
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-1 h-3.5 w-3.5 text-on-surface-variant/60 transition-opacity peer-focus:opacity-0"
        />
      </div>

      {authors.length === 0 && (
        // Kept in flow, only hidden, while the welcome card is open: removing it moved everything
        // below it (a layout shift) the moment the card opened over the page.
        <div
          className={`rounded-lg border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-6 text-center${welcomeOpen ? " invisible" : ""}`}
        >
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
              className="mt-3 inline-flex items-center gap-1.5 rounded border border-edge bg-surface-bright px-4 py-2 text-sm font-medium text-primary transition-shadow hover:shadow-card"
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
          {/* Only a filled list takes the rail's spare height: empty, it would
              push the add field to the foot of the rail, far from the
              empty-state line that points at it. */}
          <ul
            ref={listRef}
            className={`space-y-1 pr-0.5 pb-0.5 desk:min-h-0 desk:overflow-y-auto ${authors.length > 0 ? "desk:flex-1" : ""}`}
          >
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
          // Undone, the restored row's Remove button sits at this index; timed
          // out or refused, the row that took its place does.
          onFocusLost={() => setFocusAfterRemove(removed.index)}
          className="mt-3"
        />
      )}

      {addError !== null && (
        <p id={addErrorId} className="mt-4 -mb-2 text-xs text-error">
          {addError}
        </p>
      )}

      {!locked && (
        // The add button sits inside the field's end, so the rail spends one row on adding.
        <div className="relative mt-3">
          <input
            ref={addInputRef}
            id="add-contributor"
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
            aria-invalid={addError !== null}
            aria-describedby={addError !== null ? addErrorId : undefined}
            placeholder={t("addPlaceholder")}
            aria-label={t("addContributor")}
            className="w-full text-ellipsis rounded border border-edge bg-surface-bright py-2 pr-10 pl-3 text-sm text-on-surface outline-none transition-shadow placeholder:text-on-surface-variant focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!newName.trim()}
            aria-label={t("addButton")}
            title={t("addButton")}
            className="hit-area absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded text-primary transition-colors enabled:hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-on-surface-variant/50"
          >
            <PlusCircle className="h-4 w-4" />
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
      {/* Collapsed on a desktop: a rail of initials beside the grid. */}
      <div className="hidden flex-col items-center p-2 xl:flex desk:h-full desk:overflow-y-auto">
        {header}
        <ul className="flex flex-col items-center gap-1.5">
          {authors.map((author) => (
            <li key={author.id}>
              <RailChip author={author} />
            </li>
          ))}
        </ul>
      </div>
      {/* Collapsed when stacked: the same chips in one wrapping row above the grid. */}
      <div className="p-3 md:p-4 xl:hidden">
        {header}
        <ul className="-mt-1 flex flex-wrap gap-1.5">
          {authors.map((author) => (
            <li key={author.id}>
              <RailChip author={author} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * Marks a person as linked while their list row or rail chip is hovered or holds focus, as a grid
 * cell or the statement does. Mouse only: a tap enters with no leave. It clears only the list's own
 * mark, since a leave can land after a cell or the statement has taken over.
 */
function useAuthorLink(authorId: string | undefined) {
  const setStatementLink = useContributionStore((s) => s.setStatementLink);
  const link = () => authorId && setStatementLink({ contributorId: authorId, from: "author" });
  const clear = () => {
    if (useContributionStore.getState().statementLink?.from === "author") setStatementLink(null);
  };
  return {
    onPointerEnter: (event: React.PointerEvent) => event.pointerType === "mouse" && link(),
    onPointerLeave: (event: React.PointerEvent) => event.pointerType === "mouse" && clear(),
    onFocus: link,
    onBlur: clear,
  };
}

/**
 * A person in the collapsed rail: their initials chip, linked on hover or focus like a full row,
 * and the trigger for the same person menu. Named by the person; Radix adds the popup state.
 */
function RailChip({ author }: { author: Author }) {
  const linked = useContributionStore((s) => s.statementLink?.contributorId === author.id);
  const linkHandlers = useAuthorLink(author.id);
  return (
    <PersonMenu
      authorId={author.id}
      surface="rail"
      align="start"
      trigger={
        <button
          type="button"
          aria-label={author.name}
          title={author.name}
          data-linked={linked || undefined}
          {...linkHandlers}
          className="hit-area block rounded-md p-0.5 ring-offset-1 ring-offset-surface transition-shadow duration-150 hover:ring-2 hover:ring-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-linked:ring-2 data-linked:ring-primary data-[state=open]:ring-2 data-[state=open]:ring-primary motion-reduce:transition-none"
        >
          <InitialsChip author={author} />
        </button>
      }
    />
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
  const { author, updateAuthorName, setAuthorType } = useContributionStore(
    useShallow((s) => ({
      author: s.authors[index],
      updateAuthorName: s.updateAuthorName,
      setAuthorType: s.setAuthorType,
    })),
  );
  const { locked, editableAuthorId } = useClaimLock();
  const isClaimed = author !== undefined && author.id === editableAuthorId;
  const rowLocked = locked && !isClaimed;
  const isSelf = useContributionStore((s) => author !== undefined && s.selfId === author.id);
  // True while this person is hovered anywhere else (grid cell, statement name or phrase).
  const linked = useContributionStore((s) => author !== undefined && s.statementLink?.contributorId === author.id);
  const linkHandlers = useAuthorLink(author?.id);
  // Down once their answer is in, up again on a re-ask.
  const asked = useContributionStore(
    (s) => author !== undefined && review(author, s.asks[author.id]).status.kind === "asked",
  );

  const isRecentReply = useContributionStore((s) => s.recentReply !== null && s.recentReply === author?.id);

  const [nameDraft, setNameDraft] = useState(author?.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const orcidLine = useOrcidLine(author?.id ?? "", () => nameInputRef.current?.focus());

  // "Edit in list" / "Add ORCID iD" from the grid or the statement: take focus here and scroll to it.
  const listFocus = useContributionStore((s) => (s.listFocus?.authorId === author?.id ? s.listFocus : null));
  const setListFocus = useContributionStore((s) => s.setListFocus);
  const { setEditingOrcid } = orcidLine;
  useEffect(() => {
    if (!listFocus) return;
    if (listFocus.orcid) setEditingOrcid(true);
    else nameInputRef.current?.focus();
    nameInputRef.current?.scrollIntoView({ block: "nearest" });
    setListFocus(null);
  }, [listFocus, setEditingOrcid, setListFocus]);

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
      data-linked={linked || undefined}
      // Focus anywhere inside the row marks the same links as hovering it.
      {...linkHandlers}
      className={`group rounded border px-2 py-0.5 transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none ${
        isClaimed || isRecentReply
          ? "border-primary bg-primary/5"
          : linked
            ? "border-primary bg-primary/10 shadow-card"
            : "border-outline bg-surface-bright hover:border-edge hover:shadow-card"
      } ${isDragging ? "relative z-10 border-edge shadow-float" : ""}`}
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
              className="hit-area flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-outline-strong transition-colors hover:text-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
              className="min-h-6 w-full text-ellipsis bg-transparent border-none p-0 focus:ring-0 text-on-surface font-medium border-b border-primary/20 focus:border-primary outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-primary text-sm"
            />
            {nameError && (
              <span id={`author-name-error-${author.id}`} className="mt-1 block text-[11px] text-error">
                {nameError}
              </span>
            )}

            {/* Type badge, plus the ORCID trigger while there is nothing to show. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* The changing visible name shows the state; aria-pressed on
                  top of it double-encoded the same fact inverted ("Author,
                  pressed" when they are not one). */}
              <button
                type="button"
                onClick={() => setAuthorType(author.id, isNonAuthor ? "author" : "non-author")}
                disabled={rowLocked}
                title={isNonAuthor ? t("contributorTypeSetAuthor") : t("contributorTypeSetNonAuthor")}
                className="hit-area inline-flex min-h-6 items-center gap-1 rounded-full bg-surface-container px-2 text-[11px] font-medium text-on-surface-variant hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
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
                // No icon: the neighbouring type chip already shows UserCheck,
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
                <PersonMenu
                  authorId={author.id}
                  surface="list"
                  canAddOrcid={!hasOrcid && !orcidLine.editingOrcid}
                  onAddOrcid={() => orcidLine.setEditingOrcid(true)}
                  trigger={
                    <button
                      type="button"
                      aria-label={t("contributorActions", { name: author.name })}
                      title={t("contributorActions", { name: author.name })}
                      className="touch-target inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  }
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
