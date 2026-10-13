"use client";

import { Check, CheckCheck, Clock, Columns3, Rows3, Settings2, UserPlus } from "lucide-react";
import { useTheme } from "next-themes";
import { memo, type ReactNode, type RefObject, useRef, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { useShallow } from "zustand/react/shallow";
import { ColorPopover } from "@/components/ui/color-popover";
import { InitialsChip } from "@/components/ui/initials-chip";
import { LevelMark } from "@/components/ui/level-mark";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { UndoBar } from "@/components/ui/undo-bar";
import { type Author, CREDIT_ROLES, review, scoreToLevel } from "@/core";
import { LEVEL_SCORE } from "@/core/author";
import { heatCellColor, onColor } from "@/core/contributor-color";
import type { UiKey, UiTranslator } from "@/core/i18n";
import { announce } from "@/lib/announce";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useSettled } from "@/lib/use-settled";
import { type InputMode, useAskSummary, useContributionStore } from "@/store/contribution-store";
import { BulkAssignMenu, useBulkUndo } from "./BulkAssignMenu";
import { ICON_TOOL_BUTTON, LEVEL_KEY, MENU_ITEM } from "./grid-shared";
import { HeatmapExports } from "./HeatmapExports";
import { MobileRoleList } from "./MobileRoleList";
import { RoleInfo } from "./RoleInfo";

// Clicks in Levels mode cycle through the scores ascending; the legend renders
// them descending (lead→none).
const LEVEL_CYCLE: number[] = Object.values(LEVEL_SCORE);
const FLAT_KEY: { key: UiKey; score: number }[] = [
  { key: "contributed", score: 100 },
  { key: "none", score: 0 },
];

// Past this many columns the angled names make the header taller than the
// rows it labels, so the headers fall back to initials.
const MAX_NAMED_COLUMNS = 20;

/** Where this contributor's ask stands, from the grid's point of view. */
type AskState = { kind: "you" | "asked" | "settled" | "none" } | { kind: "differs"; count: number };

/**
 * The contribution matrix as one editable grid: roles as rows, contributors as
 * columns (or transposed), every cell a toggle. This doubles as the live
 * heatmap: cell fills use the same color scale as the downloadable SVG/PNG.
 */
export function ContributionGrid() {
  const {
    authors,
    inputMode,
    setInputMode,
    heatmapMonoColor,
    setHeatmapMonoColor,
    setAuthorScore,
    toggleContribution,
    welcomeOpen,
  } = useContributionStore(
    // Only what the grid renders: a whole-store subscription re-rendered every
    // cell on writes it never shows, such as a title edit or a recorded ask.
    useShallow((s) => ({
      authors: s.authors,
      inputMode: s.inputMode,
      setInputMode: s.setInputMode,
      heatmapMonoColor: s.heatmapMonoColor,
      setHeatmapMonoColor: s.setHeatmapMonoColor,
      setAuthorScore: s.setAuthorScore,
      toggleContribution: s.toggleContribution,
      welcomeOpen: s.welcomeOpen,
    })),
  );
  const recentReply = useContributionStore((s) => s.recentReply);
  const asks = useContributionStore((s) => s.asks);
  const selfId = useContributionStore((s) => s.selfId);
  const reviewHighlight = useContributionStore((s) => s.reviewHighlight);
  const reviewSettled = useContributionStore((s) => s.reviewSettled);
  const openReview = useContributionStore((s) => s.openReview);
  const setInspectorTab = useContributionStore((s) => s.setInspectorTab);
  const summary = useAskSummary();
  // The light ramp mixes toward white, which reads inverted on a dark page.
  const dark = useTheme().resolvedTheme === "dark";
  const {
    describeRole,
    translateInterfaceRole,
    translateInterfaceUi: translateUi,
    interfaceRoleLanguage,
  } = useCreditTranslators();
  const t = useTranslations();
  // The interface messages load separately from the role catalog, so a cell's
  // label depends on both; see GridCell's `language`.
  const messagesLocale = useLocale();
  // The store already refuses locked edits; this makes the grid look refused
  // too, instead of offering controls that silently do nothing.
  const { locked, editableAuthorId } = useClaimLock();
  const isFrozen = (authorId: string) => locked && authorId !== editableAuthorId;
  // Second beat of the population sequence; see .enter-fade in globals.css.
  const settled = useSettled();
  const [acronyms, setAcronyms] = useState(false);
  const [transpose, setTranspose] = useState(false);
  // The single tab stop in the matrix; arrow keys move it. Reset when the
  // orientation flips, since row/col swap meaning.
  const [activeCell, setActiveCell] = useState({ row: 0, col: 0 });
  // Handlers for the memoized cells, refreshed every render. The cells read
  // them through this ref, so a new closure never re-renders all 14×N of them.
  const cellApi = useRef<CellApi>(null);
  const { bulkUndo, runBulk, undoBulk } = useBulkUndo();
  // Right-click level picker: direct selection for pointer users, so correcting
  // an overshoot never means cycling a value through None. The anchor is the
  // cursor point; the cell element takes focus back when the panel closes.
  const [picker, setPicker] = useState<{
    authorId: string;
    roleIndex: number;
    x: number;
    y: number;
    cell: HTMLButtonElement;
  } | null>(null);

  // Graded (level) colors and labels follow the input mode, so the legend and
  // cells always match the way clicks behave.
  const graded = inputMode === "levels";
  const inputModeOptions: { value: InputMode; label: string }[] = [
    { value: "toggle", label: t("modeYesNo") },
    { value: "levels", label: t("modeLevels") },
  ];

  /** Accessible name for one assignment: cells, the mobile list and every announcement share it. */
  const levelLabel = (score: number) => translateUi(graded ? scoreToLevel(score) : score > 0 ? "contributed" : "none");
  const assignmentLabel = (author: Author, roleIndex: number, score: number) =>
    t("a11yRoleAssignment", {
      role: translateInterfaceRole(CREDIT_ROLES[roleIndex]?.name ?? ""),
      name: author.name,
      level: levelLabel(score),
    });

  function handleCellClick(author: Author, roleIndex: number, score: number) {
    if (isFrozen(author.id)) return;
    if (inputMode === "levels") {
      // Step up to the next level, wrapping at the top. An off-cycle score from
      // imported data (say 50) simply steps up to the level above it.
      const next = LEVEL_CYCLE.find((step) => step > score) ?? 0;
      setAuthorScore(author.id, roleIndex, next);
      // The pressed state alone can't convey a 4-level value to screen readers.
      announce(assignmentLabel(author, roleIndex, next));
    } else {
      toggleContribution(author.id, roleIndex);
    }
  }

  if (authors.length === 0) {
    return (
      <div className="p-3 md:p-4">
        <h2 className="sr-only">{t("stepContributions")}</h2>
        {welcomeOpen ? (
          <p className="text-sm text-on-surface-variant">{t("gridEmptyHint")}</p>
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-6 text-center">
            <UserPlus className="h-8 w-8 text-outline-variant mb-2 mx-auto" />
            <p className="text-sm text-on-surface-variant">{t("gridEmptyHint")}</p>
          </div>
        )}
      </div>
    );
  }

  // Grid extent, in the current orientation: transposed puts contributors on
  // rows and roles on columns, otherwise the reverse.
  const rowCount = transpose ? authors.length : CREDIT_ROLES.length;
  const colCount = transpose ? CREDIT_ROLES.length : authors.length;
  // Clamp at render rather than resetting in an effect, so flipping the
  // orientation or removing a contributor can never leave the only tab stop
  // pointing at a cell that no longer exists.
  const active = {
    row: Math.min(activeCell.row, Math.max(0, rowCount - 1)),
    col: Math.min(activeCell.col, Math.max(0, colCount - 1)),
  };

  function handleCellKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number,
    author: Author,
    roleIndex: number,
  ) {
    // Direct entry: 0–3 set none/supporting/equal/lead without cycling, so a
    // keyboard user never has to destroy a value to correct an overshoot. In
    // yes/no mode only 0 and 1 mean anything.
    // Arrow/Home/End still work on a frozen cell — only the value keys stop, so
    // a claimee can still read their way across the matrix.
    const digit = isFrozen(author.id) ? -1 : "0123".indexOf(event.key);
    if (digit !== -1) {
      const score = graded ? (LEVEL_CYCLE[digit] ?? 0) : digit === 0 ? 0 : digit === 1 ? 100 : null;
      if (score === null) return;
      event.preventDefault();
      setAuthorScore(author.id, roleIndex, score);
      announce(assignmentLabel(author, roleIndex, score));
      return;
    }

    // Off the role edge of the matrix, focus steps onto the role name, which
    // opens its description. The role names sit outside the tab order, so this
    // is how a keyboard user reaches them.
    if (event.key === (transpose ? "ArrowUp" : "ArrowLeft") && (transpose ? row : col) === 0) {
      const head = event.currentTarget
        .closest("table")
        ?.querySelector<HTMLButtonElement>(`[data-role-head="${transpose ? col : row}"]`);
      if (head) {
        event.preventDefault();
        head.focus();
        return;
      }
    }

    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    let next: { row: number; col: number } | null = null;
    const delta = moves[event.key];
    if (delta) next = { row: row + delta[0], col: col + delta[1] };
    else if (event.key === "Home") next = { row, col: 0 };
    else if (event.key === "End") next = { row, col: colCount - 1 };
    if (!next) return;

    // Clamp rather than wrap: running off the edge should stop, not jump to
    // the far side of a 200-column matrix.
    next.row = Math.max(0, Math.min(next.row, rowCount - 1));
    next.col = Math.max(0, Math.min(next.col, colCount - 1));
    if (next.row === row && next.col === col) return;

    event.preventDefault();
    setActiveCell(next);
    const target = event.currentTarget
      .closest("table")
      ?.querySelector<HTMLButtonElement>(`[data-cell="${next.row}-${next.col}"]`);
    target?.focus();
  }

  /** Arrow keys on a role name: along the role axis, or back into the matrix. */
  function handleRoleHeadKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, roleIndex: number) {
    const table = event.currentTarget.closest("table");
    const [previous, next, intoGrid] = transpose
      ? ["ArrowLeft", "ArrowRight", "ArrowDown"]
      : ["ArrowUp", "ArrowDown", "ArrowRight"];
    let selector: string | null = null;
    if (event.key === intoGrid) {
      const cell = transpose ? { row: 0, col: roleIndex } : { row: roleIndex, col: 0 };
      setActiveCell(cell);
      selector = `[data-cell="${cell.row}-${cell.col}"]`;
    } else if (event.key === previous || event.key === next) {
      const target = roleIndex + (event.key === next ? 1 : -1);
      if (target >= 0 && target < CREDIT_ROLES.length) selector = `[data-role-head="${target}"]`;
    }
    if (!selector) return;
    event.preventDefault();
    table?.querySelector<HTMLButtonElement>(selector)?.focus();
  }

  // Locked, this is someone else's draft: their asks are not yours to track.
  const reviewOf = (author: Author) => (locked || author.id === selfId ? undefined : review(author, asks[author.id]));
  const askState = (author: Author): AskState => {
    if (locked) return { kind: author.id === editableAuthorId ? "you" : "none" };
    if (author.id === selfId) return { kind: "you" };
    const { status, open } = review(author, asks[author.id]);
    if (open.length > 0) return { kind: "differs", count: open.length };
    return { kind: status.kind === "differs" ? "asked" : status.kind };
  };
  /** What a co-author said where it differs from the cell, for its accessible description. */
  const theySay = (author: Author, roleIndex: number) => {
    const role = CREDIT_ROLES[roleIndex]?.name;
    const difference = reviewOf(author)?.open.find((candidate) => candidate.target === role);
    if (!difference || typeof difference.theirs === "boolean") return undefined;
    // In yes/no mode a level is only worth naming when both sides contributed.
    const level = graded || difference.kind === "level" ? difference.theirs : "contributed";
    return t("cellTheySay", { name: author.firstName || author.name, level: translateUi(level) });
  };
  const namedHeaders = !acronyms && authors.length <= MAX_NAMED_COLUMNS;

  cellApi.current = {
    label: assignmentLabel,
    click: handleCellClick,
    keyDown: handleCellKeyDown,
    focus: (row, col) => setActiveCell({ row, col }),
    openPicker: (authorId, roleIndex, event) => {
      event.preventDefault();
      setPicker({ authorId, roleIndex, x: event.clientX, y: event.clientY, cell: event.currentTarget });
    },
  };
  const renderCell = (author: Author, roleIndex: number, row: number, col: number) => (
    <GridCell
      key={`${author.id}-${CREDIT_ROLES[roleIndex]?.name}`}
      api={cellApi as RefObject<CellApi>}
      author={author}
      roleIndex={roleIndex}
      row={row}
      col={col}
      tabbable={row === active.row && col === active.col}
      frozen={isFrozen(author.id)}
      recent={author.id === recentReply}
      theySay={theySay(author, roleIndex)}
      highlighted={
        reviewHighlight?.contributorId === author.id && reviewHighlight.target === CREDIT_ROLES[roleIndex]?.name
      }
      settling={
        reviewSettled?.contributorId === author.id &&
        reviewSettled.targets.some((target) => target === CREDIT_ROLES[roleIndex]?.name)
      }
      graded={graded}
      dark={dark}
      monoColor={heatmapMonoColor}
      language={`${interfaceRoleLanguage}:${messagesLocale}`}
    />
  );

  /** A role's name in the matrix: opens its description, and joins the grid's arrow-key focus. */
  const roleHead = (roleIndex: number, className?: string) => {
    const role = CREDIT_ROLES[roleIndex];
    if (!role) return null;
    return (
      <RoleInfo
        role={role}
        translateRole={translateInterfaceRole}
        describeRole={describeRole}
        language={interfaceRoleLanguage}
        className={className}
        triggerProps={{
          tabIndex: -1,
          "data-role-head": roleIndex,
          onKeyDown: (event) => handleRoleHeadKeyDown(event, roleIndex),
        }}
      />
    );
  };

  function openInspector(tab: "team" | "review") {
    setInspectorTab(tab);
    // After the tab has rendered as selected, so focus lands on a tab stop.
    requestAnimationFrame(() => document.getElementById(`inspector-tab-${tab}`)?.focus());
  }

  return (
    <div className="flex min-w-0 max-w-full flex-col desk:h-full">
      {/* The status strip: what the draft is waiting on, then every control
          that changes the whole grid. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-outline-variant/40 bg-surface-container-low px-3 py-2 md:px-4">
        <h2 id="contributions-heading" className="sr-only">
          {t("stepContributions")}
        </h2>
        {!locked && (
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span aria-hidden="true" className="flex flex-wrap gap-0.5">
              {authors.map((author) => {
                const state = askState(author);
                if (state.kind === "you") return null;
                const answered = state.kind === "differs" || state.kind === "settled";
                return (
                  <span
                    key={author.id}
                    className={`size-2 rounded-[2px] ${
                      answered ? "bg-primary" : state.kind === "asked" ? "bg-primary/35" : "bg-outline"
                    }`}
                  />
                );
              })}
            </span>
            <span className="font-semibold text-on-surface">
              {t("stripAnswered", { answered: summary.answered, total: summary.total })}
            </span>
            {summary.open > 0 ? (
              <>
                <span aria-hidden="true" className="text-on-surface-variant">
                  ·
                </span>
                <span className="text-on-surface-variant">{t("stripDiffer", { count: summary.open })}</span>
                <button
                  type="button"
                  onClick={() => openInspector("review")}
                  className="min-h-6 rounded-full bg-primary px-3 text-xs font-semibold text-on-primary transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {t("reviewAction")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => openInspector("team")}
                className="min-h-6 rounded px-1 font-semibold text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t("stripOpenTeam")}
              </button>
            )}
          </p>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <SegmentedControl
            ariaLabel={t("assignmentMode")}
            options={inputModeOptions}
            value={inputMode}
            onChange={setInputMode}
          />
          {/* One non-wrapping pair, so a narrow header moves them below the
              mode control together and the gear never dangles alone. */}
          <span className="flex items-center gap-1.5">
            {/* Every bulk action is list-wide, which a claim freezes outright. */}
            {!locked && (
              <BulkAssignMenu
                authors={authors}
                graded={graded}
                translateUi={translateUi}
                translateRole={translateInterfaceRole}
                runBulk={runBulk}
              />
            )}
            {/* Icon-only: display settings, not a workflow action, so it earns
              the quietest slot at the cluster's far end. */}
            <Popover>
              <PopoverTrigger aria-label={t("heatmapOptions")} title={t("heatmapOptions")} className={ICON_TOOL_BUTTON}>
                <Settings2 className="size-4" aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-auto max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3">
                <ColorPopover
                  value={heatmapMonoColor}
                  onChange={setHeatmapMonoColor}
                  label={t("gridColor")}
                  trigger={
                    <button
                      type="button"
                      aria-label={t("gridColor")}
                      title={t("gridColor")}
                      className="flex min-h-9 items-center gap-1.5 rounded-lg border border-outline-variant/60 px-3 text-xs font-medium text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {t("colorLabel")}
                      <span
                        className="h-3 w-3 rounded-full border border-outline-variant/50"
                        style={{ backgroundColor: heatmapMonoColor }}
                      />
                    </button>
                  }
                />
                <button
                  type="button"
                  aria-pressed={transpose}
                  onClick={() => setTranspose(!transpose)}
                  title={t("transposeHint")}
                  className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    transpose
                      ? "border-primary text-primary"
                      : "border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary"
                  }`}
                >
                  {t("transpose")}
                  {transpose ? (
                    <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
                <span className="flex min-h-9 items-center gap-1.5 text-xs text-on-surface-variant">
                  {/* The accessible name starts with the visible "Use initials",
                    so voice control saying the visible label hits it (2.5.3). */}
                  <Switch checked={acronyms} onCheckedChange={setAcronyms} aria-label={t("a11yUseInitials")} />
                  {t("useInitials")}
                </span>
              </PopoverContent>
            </Popover>
          </span>
          <HeatmapExports
            authors={authors}
            monoColor={heatmapMonoColor}
            showLevels={graded}
            transpose={transpose}
            acronyms={acronyms}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3 md:p-4">
        <MobileRoleList
          authors={authors}
          graded={graded}
          heatmapMonoColor={heatmapMonoColor}
          dark={dark}
          settled={settled}
          isFrozen={isFrozen}
          assignmentLabel={assignmentLabel}
          levelLabel={levelLabel}
          handleCellClick={handleCellClick}
          translateInterfaceRole={translateInterfaceRole}
          describeRole={describeRole}
          interfaceRoleLanguage={interfaceRoleLanguage}
        />

        {/* A bounded viewport makes both sticky axes persistent during long desktop matrices. */}
        <div
          style={{
            transitionDelay: "120ms",
            // Keeps a focused cell clear of the sticky headers when arrow keys
            // scroll the matrix (WCAG 2.4.11).
            scrollPaddingTop: namedHeaders || transpose ? "9.5rem" : "4rem",
            scrollPaddingLeft: transpose && acronyms ? "6rem" : "12.5rem",
          }}
          className={`hidden max-h-[min(70vh,44rem)] max-w-full overflow-auto md:block desk:max-h-none desk:min-h-0 desk:flex-1 ${
            settled ? "enter-fade " : ""
          }${
            // Right padding lets the last angled label overhang its own column:
            // a 9rem label rotated 50° reaches ~5.8rem past its own centre.
            transpose || namedHeaders ? "pr-24" : ""
          }`}
        >
          <table
            aria-labelledby="contributions-heading"
            className="mx-auto w-max table-auto border-separate border-spacing-[3px]"
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  className={`sticky left-0 top-0 z-40 bg-surface-bright pb-1 text-left align-bottom font-mono text-xs font-medium uppercase tracking-wider text-on-surface-variant ${
                    // Transposed with initials, the row headers are 40px chips,
                    // let the axis title size the column instead of reserving the
                    // width a full role name needs.
                    transpose && acronyms ? "" : "min-w-40 md:min-w-48"
                  }`}
                >
                  {transpose ? t("contributorColumn") : t("roleColumn")}
                </th>
                {transpose
                  ? CREDIT_ROLES.map((role, columnIndex) => (
                      <th
                        key={role.name}
                        scope="col"
                        // An angled label overhangs its own column to the right, so
                        // without a reversed paint order the next header's opaque
                        // background covers all but its first few characters.
                        style={{ zIndex: 20 + (CREDIT_ROLES.length - columnIndex) }}
                        className="sticky top-0 min-w-[2rem] bg-surface-bright pb-1 align-bottom"
                      >
                        <AngledLabel title={translateInterfaceRole(role.name)}>
                          {roleHead(columnIndex, "text-xs")}
                        </AngledLabel>
                      </th>
                    ))
                  : authors.map((author, columnIndex) => (
                      <th
                        key={author.id}
                        scope="col"
                        style={{ zIndex: 20 + (authors.length - columnIndex) }}
                        className="sticky top-0 min-w-[2.75rem] bg-surface-bright pb-1 align-bottom"
                      >
                        <span className="flex flex-col items-center gap-1">
                          {namedHeaders ? (
                            <AngledLabel title={author.name}>
                              <span className="text-xs font-medium text-on-surface">{author.name}</span>
                            </AngledLabel>
                          ) : (
                            <>
                              <InitialsChip author={author} />
                              <span className="sr-only">{author.name}</span>
                            </>
                          )}
                          <AskGlyph
                            state={askState(author)}
                            name={author.name}
                            onReview={() => openReview(author.id)}
                          />
                        </span>
                      </th>
                    ))}
              </tr>
            </thead>
            <tbody>
              {transpose
                ? authors.map((author, authorRow) => (
                    <tr key={author.id}>
                      <th scope="row" className="sticky left-0 z-10 bg-surface-bright py-0 text-left">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <InitialsChip author={author} />
                          <AskGlyph
                            state={askState(author)}
                            name={author.name}
                            onReview={() => openReview(author.id)}
                          />
                          {!acronyms && (
                            <span
                              className="max-w-36 truncate text-[13px] font-medium text-on-surface"
                              title={author.name}
                            >
                              {author.name}
                            </span>
                          )}
                          {acronyms && <span className="sr-only">{author.name}</span>}
                        </span>
                      </th>
                      {CREDIT_ROLES.map((_, roleIndex) => renderCell(author, roleIndex, authorRow, roleIndex))}
                    </tr>
                  ))
                : CREDIT_ROLES.map((role, roleIndex) => (
                    <tr key={role.name}>
                      <th scope="row" className="sticky left-0 z-10 max-w-56 bg-surface-bright py-0 text-left">
                        {roleHead(roleIndex, "max-w-full truncate text-[13px]")}
                      </th>
                      {authors.map((author, authorCol) => renderCell(author, roleIndex, roleIndex, authorCol))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {/* Right-click level picker: one shared panel, anchored at the cursor.
          Focus returns to the cell on every close, as a context menu's does. */}
        {picker &&
          (() => {
            const pickerAuthor = authors.find((candidate) => candidate.id === picker.authorId);
            if (!pickerAuthor) return null;
            const current = pickerAuthor.contributions[picker.roleIndex]?.score ?? 0;
            const close = () => {
              picker.cell.focus();
              setPicker(null);
            };
            return (
              <Popover open onOpenChange={(open) => !open && close()}>
                <PopoverAnchor className="fixed" style={{ left: picker.x, top: picker.y }} />
                <PopoverContent align="start" className="w-40 p-1" onCloseAutoFocus={(event) => event.preventDefault()}>
                  {LEVEL_KEY.map(({ key, score }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setAuthorScore(pickerAuthor.id, picker.roleIndex, score);
                        announce(assignmentLabel(pickerAuthor, picker.roleIndex, score));
                        close();
                      }}
                      className={MENU_ITEM}
                    >
                      <span
                        className="h-3 w-3 rounded-sm border border-outline-variant"
                        style={{
                          backgroundColor:
                            score > 0
                              ? heatCellColor(heatmapMonoColor, score, dark)
                              : "var(--color-surface-container-high)",
                        }}
                      />
                      {translateUi(key)}
                      {score === current && <Check aria-hidden="true" className="ml-auto size-3.5 text-primary" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            );
          })()}

        {/* Same bar a row removal gets. */}
        {bulkUndo && <UndoBar message={t("bulkChangeApplied")} onUndo={undoBulk} className="mt-2" />}

        {/* `w-0 min-w-full` keeps the legend out of the pane's max-content width,
          so switching modes cannot resize the whole column to fit a longer key. */}
        <div className="mt-2 w-0 min-w-full">
          <GridLegend
            monoColor={heatmapMonoColor}
            graded={graded}
            dark={dark}
            translateUi={translateUi}
            differs={summary.open > 0}
          />
        </div>
      </div>
    </div>
  );
}

/** What a grid cell calls back into. Read through a ref so the cells can stay memoized. */
interface CellApi {
  label: (author: Author, roleIndex: number, score: number) => string;
  click: (author: Author, roleIndex: number, score: number) => void;
  keyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number,
    author: Author,
    roleIndex: number,
  ) => void;
  focus: (row: number, col: number) => void;
  openPicker: (authorId: string, roleIndex: number, event: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * One assignment in the matrix. Memoized: immer keeps an untouched author
 * identical, so a click re-renders one contributor's cells, not all 14×N.
 * `language` is only there to re-render every label when the interface
 * language changes (role catalog and messages, which load separately), since
 * the label function arrives through `api`.
 */
const GridCell = memo(function GridCellInner({
  api,
  author,
  roleIndex,
  row,
  col,
  tabbable,
  frozen,
  recent,
  theySay,
  highlighted,
  settling,
  graded,
  dark,
  monoColor,
}: {
  api: RefObject<CellApi>;
  author: Author;
  roleIndex: number;
  row: number;
  col: number;
  tabbable: boolean;
  frozen: boolean;
  recent: boolean;
  /** "Ben says Lead" where a co-author's answer differs and is still open. */
  theySay: string | undefined;
  /** The Review line under the pointer or focus is about this cell. */
  highlighted: boolean;
  /** A Review choice just changed this cell. */
  settling: boolean;
  graded: boolean;
  dark: boolean;
  monoColor: string;
  language: string;
}) {
  const score = author.contributions[roleIndex]?.score ?? 0;
  const fill = score > 0 ? heatCellColor(monoColor, graded ? score : 100, dark) : null;
  const label = api.current.label(author, roleIndex, score);
  const describedBy = theySay ? `cell-says-${row}-${col}` : undefined;
  return (
    <td className="relative min-w-11 p-0">
      <button
        type="button"
        data-cell={`${row}-${col}`}
        data-cell-key={`${author.id}:${roleIndex}`}
        data-recent-reply={recent || undefined}
        aria-describedby={describedBy}
        // One tab stop for the whole matrix; arrows move within it. Without
        // this a keyboard user tabs through every cell, up to 14 x 200.
        tabIndex={tabbable ? 0 : -1}
        onFocus={() => api.current.focus(row, col)}
        onKeyDown={(event) => api.current.keyDown(event, row, col, author, roleIndex)}
        // A toggle only in yes/no mode: pressed semantics misdescribe a
        // four-way value, whose level the accessible name carries instead.
        aria-pressed={graded ? undefined : score > 0}
        // aria-disabled, not disabled: a disabled button drops out of the
        // roving tab order, which would strand arrow navigation on a locked
        // draft. The handlers refuse instead.
        aria-disabled={frozen || undefined}
        aria-keyshortcuts={frozen ? undefined : graded ? "0 1 2 3 Shift+F10" : "0 1"}
        onContextMenu={graded && !frozen ? (event) => api.current.openPicker(author.id, roleIndex, event) : undefined}
        aria-label={label}
        title={theySay ? `${label}. ${theySay}` : label}
        onClick={() => api.current.click(author, roleIndex, score)}
        // The fill transitions, and deliberately nothing moves: in Levels mode
        // a click's only result is the shade stepping up, and at this cadence
        // (hundreds a session, in a 3px-gapped grid) a press scale would read
        // as the matrix twitching rather than as feedback.
        // Empty cells get a hairline ring: fill-on-fill alone is ~1.2:1
        // against the card, which loses the click target on dim displays.
        className={`contribution-cell flex h-7 w-full items-center justify-center rounded transition-[background-color,box-shadow] duration-[120ms] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          frozen ? "cursor-not-allowed opacity-40" : "hover:ring-2 hover:ring-primary/50"
        } ${fill ? "" : "ring-1 ring-inset ring-outline/70"} ${
          highlighted
            ? "outline outline-[3px] outline-flag outline-offset-1"
            : recent
              ? "outline outline-2 outline-primary/50 outline-offset-1 shadow-[0_0_8px_2px_var(--tw-shadow-color)] shadow-primary/40"
              : ""
        } ${settling ? "cell-settle" : ""}`}
        style={{ backgroundColor: fill ?? "var(--color-surface-container-high)" }}
      >
        {fill && (
          // The check is the state indicator, so it must clear 3:1 against
          // the fill it sits on (WCAG 1.4.11). Hardcoded white failed that on
          // every pale fill; at the default hue's "supporting" level, and at
          // every level of the lighter presets. onColor measures instead.
          <LevelMark score={score} graded={graded} color={onColor(fill)} />
        )}
      </button>
      {theySay && (
        <>
          {/* The corner mark is a shape, so the difference never rests on colour alone. */}
          <DifferenceMark cellFill={fill} className="pointer-events-none absolute top-0 right-0" />
          <span id={describedBy} className="sr-only">
            {theySay}
          </span>
        </>
      )}
    </td>
  );
});

/**
 * Flag-coloured corner triangle for a cell a co-author answered differently.
 * The flag fill can sit near 1:1 on a strong cell, so on a filled cell the
 * triangle gets an edge in the cell's on-colour, which clears 3:1 (WCAG 1.4.11).
 */
function DifferenceMark({ cellFill, className }: { cellFill: string | null; className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" className={`size-2.5 text-flag ${className}`}>
      <path
        d="M0 0H10V10Z"
        fill="currentColor"
        stroke={cellFill ? onColor(cellFill) : "none"}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A 50°-angled column label, leaning up-right from the column's bottom
 * center, so a full name fits over a column one cell wide. The label
 * overhangs its own column, so the table wrapper pads the right edge for the
 * last one and the header cells paint in reverse order (see the thead) so a
 * neighbour's background cannot cover it.
 */
function AngledLabel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <span className="relative block h-28 w-full">
      <span
        title={title}
        className="absolute bottom-0 left-1/2 max-w-[9rem] origin-bottom-left -rotate-[50deg] overflow-hidden text-ellipsis whitespace-nowrap"
      >
        {children}
      </span>
    </span>
  );
}

/**
 * Where a column's contributor stands, as an icon, word or count with a spoken
 * label: never color alone. Open differences are a button into the Review tab.
 */
function AskGlyph({ state, name, onReview }: { state: AskState; name: string; onReview: () => void }) {
  const t = useTranslations();
  if (state.kind === "you") {
    return <span className="text-[11px] font-semibold text-primary">{t("teamYou")}</span>;
  }
  if (state.kind === "differs") {
    return (
      <button
        type="button"
        onClick={onReview}
        aria-label={t("columnOpenDifferences", { name, count: state.count })}
        title={t("columnOpenDifferences", { name, count: state.count })}
        className="inline-flex h-5 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-on-primary transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      >
        {state.count}
      </button>
    );
  }
  const label =
    state.kind === "settled" ? t("columnSettled") : state.kind === "asked" ? t("askedChip") : t("teamNotAsked");
  return (
    <span role="img" aria-label={label} title={label} className="flex h-5 items-center text-on-surface-variant">
      {state.kind === "settled" ? (
        <CheckCheck aria-hidden="true" className="size-3.5 text-primary" />
      ) : state.kind === "asked" ? (
        <Clock aria-hidden="true" className="size-3.5" />
      ) : (
        <span aria-hidden="true" className="text-xs leading-none">
          –
        </span>
      )}
    </span>
  );
}

/** A single key mapping cell intensity to its contribution level. */
function GridLegend({
  monoColor,
  graded,
  translateUi,
  dark,
  differs,
}: {
  monoColor: string;
  graded: boolean;
  translateUi: UiTranslator;
  dark: boolean;
  /** Some cell carries a difference mark, so the key explains it. */
  differs: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs text-on-surface-variant">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono uppercase tracking-wider">{graded ? t("legendLevel") : t("legendKey")}</span>
        {(graded ? LEVEL_KEY : FLAT_KEY).map(({ key, score }) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-flex h-3 items-center justify-center rounded-sm border border-outline-variant ${graded ? "w-6" : "w-3"}`}
              style={{
                // Zero-score swatch matches the grid's theme-aware empty cells,
                // not the download SVG's fixed paper-white fill.
                backgroundColor:
                  score > 0 ? heatCellColor(monoColor, score, dark) : "var(--color-surface-container-high)",
              }}
            >
              {graded && score > 0 && (
                <LevelMark score={score} graded color={onColor(heatCellColor(monoColor, score, dark))} size="small" />
              )}
            </span>
            {translateUi(key)}
          </span>
        ))}
        {differs && (
          <span className="inline-flex items-center gap-1.5">
            {/* Shown on a Lead swatch, where the flag fill alone has the least contrast. */}
            <span
              className="relative inline-block size-3 rounded-sm"
              style={{ backgroundColor: heatCellColor(monoColor, 100, dark) }}
            >
              <DifferenceMark cellFill={heatCellColor(monoColor, 100, dark)} className="absolute top-0 right-0" />
            </span>
            {t("legendDiffers")}
          </span>
        )}
      </span>
      {/* Always shown and never truncated: the keys are the only direct way to
          set a level, so hiding them behind a tooltip hid the feature. */}
      <p>{graded ? t("levelHint") : t("toggleKeysHint")}</p>
    </div>
  );
}
