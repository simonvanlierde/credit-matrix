"use client";

import {
  Check,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  Info,
  ListChecks,
  Rows3,
  Settings2,
  UserPlus,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { ColorPopover } from "@/components/ui/color-popover";
import { InitialsChip } from "@/components/ui/initials-chip";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StepHeader } from "@/components/ui/step-header";
import { Switch } from "@/components/ui/switch";
import { UndoBar } from "@/components/ui/undo-bar";
import {
  type Author,
  buildHeatmapSvg,
  CREDIT_ROLES,
  heatCellColor,
  onColor,
  type RoleDescriber,
  type RoleTranslator,
  scoreToLevel,
  type UiKey,
  type UiTranslator,
} from "@/core";
import { announce } from "@/lib/announce";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useSettled } from "@/lib/use-settled";
import { download as downloadBlob } from "@/lib/utils";
import { type InputMode, useContributionStore } from "@/store/contribution-store";

// Canonical level↔score mapping. Clicks in Levels mode cycle through it
// ascending; the legend renders it descending (lead→none).
const LEVEL_CYCLE = [0, 33, 66, 100];
const LEVEL_KEY: { key: UiKey; score: number }[] = [
  { key: "lead", score: 100 },
  { key: "equal", score: 66 },
  { key: "supporting", score: 33 },
  { key: "none", score: 0 },
];
const FLAT_KEY: { key: UiKey; score: number }[] = [
  { key: "contributed", score: 100 },
  { key: "none", score: 0 },
];

// "None" is what Clear does, so the bulk picker offers only the assignable levels.
const ASSIGNABLE_LEVELS = LEVEL_KEY.filter(({ score }) => score > 0);
// Equal, not Lead: bulk-marking everyone as Lead overstates every one of them.
const DEFAULT_BULK_LEVEL = 66;

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
    loadAuthors,
    setAuthorScore,
    setAllAuthorScores,
    setRoleScores,
    toggleContribution,
    welcomeOpen,
  } = useContributionStore();
  const recentReply = useContributionStore((s) => s.recentReply);
  const {
    describeRole,
    translateInterfaceRole,
    translateInterfaceUi: translateUi,
    interfaceRoleLanguage,
  } = useCreditTranslators();
  const t = useTranslations();
  // The store already refuses locked edits; this makes the grid look refused
  // too, instead of offering controls that silently do nothing.
  const { locked, editableAuthorId } = useClaimLock();
  const isFrozen = (authorId: string) => locked && authorId !== editableAuthorId;
  // Second beat of the population sequence; see .enter-fade in globals.css.
  const settled = useSettled();
  const [acronyms, setAcronyms] = useState(true);
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [bulkAuthorId, setBulkAuthorId] = useState("");
  const [transpose, setTranspose] = useState(false);
  const [bulkRoleIndex, setBulkRoleIndex] = useState("0");
  const [bulkLevel, setBulkLevel] = useState(String(DEFAULT_BULK_LEVEL));
  // The single tab stop in the matrix; arrow keys move it. Reset when the
  // orientation flips, since row/col swap meaning.
  const [activeCell, setActiveCell] = useState({ row: 0, col: 0 });
  // The roster as it stood before the last bulk action. One click can rewrite
  // fourteen assignments, so it earns the same undo bar a row removal has.
  const [bulkUndo, setBulkUndo] = useState<Author[] | null>(null);
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

  useEffect(() => {
    if (!bulkUndo) return;
    const timer = window.setTimeout(() => setBulkUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [bulkUndo]);

  /** Run a bulk mutation with the roster snapshotted for undo. */
  function runBulk(action: () => void) {
    const before = useContributionStore.getState().authors;
    action();
    setBulkUndo(before);
    announce(t("bulkChangeApplied"));
  }

  // NOTE: restores the whole roster snapshot, so it also reverts any edit made
  // inside the 8-second window — simple last-state undo, not an operation log.
  function undoBulk() {
    if (!bulkUndo) return;
    loadAuthors(bulkUndo);
    announce(t("annBulkUndone"));
    setBulkUndo(null);
  }

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
      <div className="bg-surface-bright rounded-lg shadow-sm border border-outline-variant/20 p-3 md:p-4">
        <StepHeader n={2} title={t("stepContributions")} className="mb-3" />
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

  const firstAuthor = authors[0];
  if (!firstAuthor) return null;
  // On a locked draft the only editable row is the claimee's, so open there
  // rather than on whoever happens to sort first.
  const selectedAuthor =
    authors.find((author) => author.id === selectedAuthorId) ??
    (locked ? authors.find((author) => author.id === editableAuthorId) : undefined) ??
    firstAuthor;
  const bulkAuthor = authors.find((author) => author.id === bulkAuthorId) ?? firstAuthor;
  const parsedBulkRoleIndex = Number.parseInt(bulkRoleIndex, 10);
  // Yes/no has one "assigned" value; levels asks which one.
  const assignScore = graded ? Number.parseInt(bulkLevel, 10) : 100;

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

  const renderCell = (author: Author, roleIndex: number, row: number, col: number) => {
    const role = CREDIT_ROLES[roleIndex];
    const score = author.contributions[roleIndex]?.score ?? 0;
    const frozen = isFrozen(author.id);
    // The row a just-opened reply filled in. The worded Updated badge lives on
    // the contributor row; here the same fact is a halo over their cells, in
    // either orientation, so the change is visible where the roles landed.
    const recent = author.id === recentReply;
    const fill = score > 0 ? heatCellColor(heatmapMonoColor, graded ? score : 100) : null;
    const label = assignmentLabel(author, roleIndex, score);
    return (
      <td key={`${author.id}-${role?.name}`} className="min-w-11 p-0">
        <button
          type="button"
          data-cell={`${row}-${col}`}
          // One tab stop for the whole matrix; arrows move within it. Without
          // this a keyboard user tabs through every cell, up to 14 x 200.
          tabIndex={row === active.row && col === active.col ? 0 : -1}
          onFocus={() => setActiveCell({ row, col })}
          onKeyDown={(event) => handleCellKeyDown(event, row, col, author, roleIndex)}
          // A toggle only in yes/no mode: pressed semantics misdescribe a
          // four-way value, whose level the accessible name carries instead.
          aria-pressed={graded ? undefined : score > 0}
          // aria-disabled, not disabled: a disabled button drops out of the
          // roving tab order, which would strand arrow navigation on a locked
          // draft. The handlers refuse instead.
          aria-disabled={frozen || undefined}
          onContextMenu={
            graded && !frozen
              ? (event) => {
                  event.preventDefault();
                  setPicker({
                    authorId: author.id,
                    roleIndex,
                    x: event.clientX,
                    y: event.clientY,
                    cell: event.currentTarget,
                  });
                }
              : undefined
          }
          aria-label={label}
          title={label}
          onClick={() => handleCellClick(author, roleIndex, score)}
          // The fill transitions, and deliberately nothing moves: in Levels mode
          // a click's only result is the shade stepping up, and at this cadence
          // (hundreds a session, in a 3px-gapped grid) a press scale would read
          // as the matrix twitching rather than as feedback.
          // Empty cells get a hairline ring: fill-on-fill alone is ~1.2:1
          // against the card, which loses the click target on dim displays.
          className={`contribution-cell flex h-7 w-full items-center justify-center rounded transition-[background-color,box-shadow] duration-[120ms] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            frozen ? "cursor-not-allowed opacity-40" : "hover:ring-2 hover:ring-primary/50"
          } ${fill ? "" : "ring-1 ring-inset ring-outline/70"} ${
            recent
              ? "outline outline-2 outline-primary/50 outline-offset-1 shadow-[0_0_8px_2px_var(--tw-shadow-color)] shadow-primary/40"
              : ""
          }`}
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
      </td>
    );
  };

  return (
    <div className="flex min-w-0 max-w-full flex-col bg-surface-bright rounded-lg shadow-sm border border-outline-variant/20 p-3 md:p-4 desk:h-full desk:overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <StepHeader n={2} title={t("stepContributions")} id="contributions-heading" />
        <div className="flex flex-wrap items-start gap-1.5">
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
              <Popover>
                <PopoverTrigger
                  aria-label={t("bulkAssign")}
                  title={t("bulkAssign")}
                  className="flex size-9 items-center justify-center rounded-lg border border-outline-variant/60 text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:border-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
                >
                  <ListChecks className="size-4" aria-hidden="true" />
                </PopoverTrigger>
                <PopoverContent align="end" className="grid w-72 max-w-[calc(100vw-2rem)] gap-4">
                  {graded && (
                    <div className="grid gap-2 text-xs font-semibold text-on-surface">
                      <span id="bulk-level">{t("bulkAssignLevel")}</span>
                      <Select value={bulkLevel} onValueChange={setBulkLevel}>
                        <SelectTrigger className="w-full text-xs font-normal" aria-labelledby="bulk-level">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_LEVELS.map(({ key, score }) => (
                            <SelectItem key={key} value={String(score)}>
                              {translateUi(key)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {/* A <legend> renders unreliably inside a `display: grid` fieldset,
                  so the group is labelled by a plain heading instead. */}
                  <fieldset aria-labelledby="bulk-one-contributor" className="grid gap-2">
                    <p id="bulk-one-contributor" className="mb-1 text-xs font-semibold text-on-surface">
                      {t("bulkOneContributor")}
                    </p>
                    <Select value={bulkAuthor?.id} onValueChange={setBulkAuthorId}>
                      <SelectTrigger className="w-full text-xs" aria-label={t("a11yBulkContributor")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {authors.map((author) => (
                          <SelectItem key={author.id} value={author.id}>
                            {author.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <BulkButton onClick={() => runBulk(() => setAllAuthorScores(bulkAuthor.id, assignScore))}>
                        {t("bulkAssignAll")}
                      </BulkButton>
                      <BulkButton onClick={() => runBulk(() => setAllAuthorScores(bulkAuthor.id, 0))}>
                        {t("bulkClearAll")}
                      </BulkButton>
                    </div>
                  </fieldset>
                  <fieldset
                    aria-labelledby="bulk-one-role"
                    className="grid gap-2 border-t border-outline-variant/30 pt-3"
                  >
                    <p id="bulk-one-role" className="mb-1 text-xs font-semibold text-on-surface">
                      {t("bulkOneRole")}
                    </p>
                    <Select value={bulkRoleIndex} onValueChange={setBulkRoleIndex}>
                      <SelectTrigger className="w-full text-xs" aria-label={t("a11yBulkRole")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CREDIT_ROLES.map((role, roleIndex) => (
                          <SelectItem key={role.name} value={String(roleIndex)}>
                            {translateInterfaceRole(role.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <BulkButton onClick={() => runBulk(() => setRoleScores(parsedBulkRoleIndex, assignScore))}>
                        {t("bulkAssignToAll")}
                      </BulkButton>
                      <BulkButton onClick={() => runBulk(() => setRoleScores(parsedBulkRoleIndex, 0))}>
                        {t("bulkClearRole")}
                      </BulkButton>
                    </div>
                  </fieldset>
                </PopoverContent>
              </Popover>
            )}
            {/* Icon-only: display settings, not a workflow action, so it earns
              the quietest slot at the cluster's far end. */}
            <Popover>
              <PopoverTrigger
                aria-label={t("heatmapOptions")}
                title={t("heatmapOptions")}
                className="flex size-9 items-center justify-center rounded-lg border border-outline-variant/60 text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:border-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
              >
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
                  className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
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
        </div>
      </div>

      <div className={`md:hidden ${settled ? "enter-fade" : ""}`} style={{ transitionDelay: "120ms" }}>
        <div className="sticky top-13 z-20 -mx-1 mb-2 bg-surface-bright px-1 py-2">
          <label className="mb-1.5 block text-xs font-semibold text-on-surface" htmlFor="mobile-contributor">
            {t("contributorToAssign")}
          </label>
          <Select value={selectedAuthor.id} onValueChange={setSelectedAuthorId}>
            <SelectTrigger id="mobile-contributor" className="w-full" aria-label={t("contributorToAssign")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {authors.map((author) => (
                <SelectItem key={author.id} value={author.id}>
                  {author.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul
          className="divide-y divide-outline-variant/25"
          aria-label={t("a11yRolesForContributor", { name: selectedAuthor.name })}
        >
          {CREDIT_ROLES.map((role, roleIndex) => {
            const score = selectedAuthor.contributions[roleIndex]?.score ?? 0;
            return (
              <li key={role.name} className="flex min-h-14 items-center gap-2 py-1.5">
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="text-sm font-medium text-on-surface">{translateInterfaceRole(role.name)}</span>
                  <RoleInfo
                    role={role}
                    translateRole={translateInterfaceRole}
                    describeRole={describeRole}
                    language={interfaceRoleLanguage}
                  />
                </span>
                <button
                  type="button"
                  // Same as the desktop cell: pressed semantics only fit yes/no.
                  aria-pressed={graded ? undefined : score > 0}
                  // No roving tab order to protect here, so the plain disabled
                  // idiom (as the export buttons use) fits.
                  disabled={isFrozen(selectedAuthor.id)}
                  aria-label={assignmentLabel(selectedAuthor, roleIndex, score)}
                  onClick={() => handleCellClick(selectedAuthor, roleIndex, score)}
                  className={`contribution-cell flex min-h-11 min-w-24 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-surface-container-high px-3 text-xs font-semibold transition-[background-color,box-shadow] duration-[120ms] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                    score > 0 ? "text-on-surface shadow-sm" : "text-on-surface-variant"
                  }`}
                >
                  {/* The label never sits on the dynamic fill: a mid-tone
                      preset has no 4.5:1 text companion at all, and the
                      palette is user-picked. The swatch carries the color;
                      its check needs only the 3:1 non-text ratio, which
                      onColor guarantees. */}
                  {score > 0 && (
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded"
                      style={(() => {
                        const fill = heatCellColor(heatmapMonoColor, graded ? score : 100);
                        return { backgroundColor: fill, color: onColor(fill) };
                      })()}
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  )}
                  {levelLabel(score)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* A bounded viewport makes both sticky axes persistent during long desktop matrices. */}
      <div
        style={{ transitionDelay: "120ms" }}
        className={`hidden max-h-[min(70vh,44rem)] max-w-full overflow-auto md:block desk:max-h-none desk:min-h-0 desk:flex-1 ${
          settled ? "enter-fade " : ""
        }${
          // Right padding lets the last angled label overhang its own column:
          // a 9.5rem label rotated 45° reaches ~107px past its own centre.
          transpose || !acronyms ? "pr-32" : ""
        }`}
      >
        <table
          aria-labelledby="contributions-heading"
          className="w-max min-w-full table-auto border-separate border-spacing-[3px]"
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
                      <span className="flex flex-col items-center gap-1">
                        <AngledLabel text={translateInterfaceRole(role.name)} />
                        <RoleInfo
                          role={role}
                          translateRole={translateInterfaceRole}
                          describeRole={describeRole}
                          language={interfaceRoleLanguage}
                        />
                      </span>
                    </th>
                  ))
                : authors.map((author, columnIndex) => (
                    <th
                      key={author.id}
                      scope="col"
                      style={{ zIndex: 20 + (authors.length - columnIndex) }}
                      className="sticky top-0 min-w-[2.75rem] bg-surface-bright pb-1 align-bottom"
                    >
                      {acronyms ? (
                        <>
                          <InitialsChip author={author} />
                          <span className="sr-only">{author.name}</span>
                        </>
                      ) : (
                        <AngledLabel text={author.name} />
                      )}
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
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-surface-bright py-0 text-left font-medium text-[13px] text-on-surface"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate" title={translateInterfaceRole(role.name)}>
                          {translateInterfaceRole(role.name)}
                        </span>
                        <RoleInfo
                          role={role}
                          translateRole={translateInterfaceRole}
                          describeRole={describeRole}
                          language={interfaceRoleLanguage}
                        />
                      </span>
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
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container"
                  >
                    <span
                      className="h-3 w-3 rounded-sm border border-outline-variant"
                      style={{
                        backgroundColor:
                          score > 0 ? heatCellColor(heatmapMonoColor, score) : "var(--color-surface-container-high)",
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

      {/* No flex-wrap here: the export buttons stay pinned right in both modes,
          and the legend (which is longer in Levels) wraps inside its own share
          of the row instead of displacing them.
          `w-0 min-w-full` keeps this row out of the card's max-content width, so
          switching modes cannot resize the whole column to fit a longer legend. */}
      {/* items-start: the legend may wrap taller in Levels, and a centered
          export cluster would ride the height change. Anchored to the row's
          top, it holds still whatever the legend does below. */}
      <div className="mt-2 flex w-0 min-w-full items-start justify-between gap-3">
        <GridLegend monoColor={heatmapMonoColor} graded={graded} translateUi={translateUi} />
        <HeatmapExports
          authors={authors}
          monoColor={heatmapMonoColor}
          showLevels={graded}
          transpose={transpose}
          acronyms={acronyms}
        />
      </div>
    </div>
  );
}

function BulkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-9 rounded-lg border border-outline-variant/60 px-2 text-xs font-medium text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </button>
  );
}

/**
 * A 45°-angled column label for long names in narrow columns, leaning up-right
 * from the column's bottom center, the same style as the downloaded heatmap's
 * top axis. The label overhangs its own column, so the table wrapper pads the
 * right edge for the last one and the header cells paint in reverse order (see
 * the thead) so a neighbour's background cannot cover it.
 */
function AngledLabel({ text }: { text: string }) {
  return (
    <span className="relative block h-28 w-full">
      <span
        title={text}
        className="absolute bottom-0 left-1/2 max-w-[9.5rem] origin-bottom-left -rotate-45 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium text-on-surface-variant"
      >
        {text}
      </span>
    </span>
  );
}

/** The role's short description with a link to its full NISO definition. */
function RoleInfo({
  role,
  translateRole,
  describeRole,
  language,
}: {
  role: (typeof CREDIT_ROLES)[number];
  translateRole: RoleTranslator;
  describeRole: RoleDescriber;
  language: string;
}) {
  const t = useTranslations();
  // The name follows the output language (it must match the statement); the
  // description follows the interface language (it is help, never exported).
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("aboutRole", { role: translateRole(role.name) })}
          className="touch-target flex size-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent lang={language} className="max-w-xs text-xs leading-relaxed text-on-surface-variant">
        <strong className="text-on-surface">{translateRole(role.name)}.</strong> {describeRole(role.name)}{" "}
        <a
          href={role.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-primary hover:underline whitespace-nowrap"
        >
          {t("fullDefinition")}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{t("opensInNewTab")}</span>
        </a>
      </PopoverContent>
    </Popover>
  );
}

const LEVEL_DOTS: Record<string, number> = { supporting: 1, equal: 2, lead: 3 };

/**
 * What an assigned cell shows. Yes/no mode keeps the check; Levels mode counts
 * the level in dots (1 supporting, 2 equal, 3 lead), so the level never rests
 * on fill lightness alone (WCAG 1.4.1). `color` must come from onColor so the
 * mark clears 3:1 against its fill (WCAG 1.4.11).
 */
function LevelMark({
  score,
  graded,
  color,
  size = "cell",
}: {
  score: number;
  graded: boolean;
  color: string;
  size?: "cell" | "small";
}) {
  if (!graded) return <Check aria-hidden="true" className="size-3.5" style={{ color }} strokeWidth={3} />;
  const dots = LEVEL_DOTS[scoreToLevel(score)] ?? 0;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${dots * 6 - 1} 5`}
      className={size === "cell" ? "h-1.5 w-auto" : "h-1 w-auto"}
      style={{ color }}
    >
      {Array.from({ length: dots }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the dots are identical and never reorder.
        <circle key={i} cx={2.5 + i * 6} cy={2.5} r={2.5} fill="currentColor" />
      ))}
    </svg>
  );
}

/** A single key mapping cell intensity to its contribution level. */
function GridLegend({
  monoColor,
  graded,
  translateUi,
}: {
  monoColor: string;
  graded: boolean;
  translateUi: UiTranslator;
}) {
  const t = useTranslations();
  return (
    // The label heads the legend rather than sharing its line, so the entries
    // get the full width and no longer dangle onto a second row in Levels. Both
    // modes are two lines, so switching them cannot change the row's height.
    <div className="flex min-w-0 flex-col gap-1 text-xs text-on-surface-variant">
      <span className="flex min-w-0 items-center gap-3">
        <span className="font-mono text-xs uppercase tracking-wider">{graded ? t("legendLevel") : t("legendKey")}</span>
        {/* Yes/no needs no hint: the grid says it. Levels does, because the click
            cycle isn't visible. Capped to one line (full text in the tooltip):
            a wrapped hint made this row taller in Levels, so toggling modes
            bounced the export cluster below. */}
        {graded && (
          <span className="min-w-0 truncate" title={`${t("clickToCycle")} · ${t("levelKeysHint")}`}>
            {/* A language-neutral separator: the two hints are separate
                sentences, and jamming them read as one run-on label. */}
            {t("clickToCycle")} <span className="hidden md:inline">· {t("levelKeysHint")}</span>
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {(graded ? LEVEL_KEY : FLAT_KEY).map(({ key, score }) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-flex h-3 items-center justify-center rounded-sm border border-outline-variant ${graded ? "w-6" : "w-3"}`}
              style={{
                // Zero-score swatch matches the grid's theme-aware empty cells,
                // not the download SVG's fixed paper-white fill.
                backgroundColor: score > 0 ? heatCellColor(monoColor, score) : "var(--color-surface-container-high)",
              }}
            >
              {graded && score > 0 && (
                <LevelMark score={score} graded color={onColor(heatCellColor(monoColor, score))} size="small" />
              )}
            </span>
            {translateUi(key)}
          </span>
        ))}
      </span>
    </div>
  );
}

type ExportFormat = "svg" | "png";

/**
 * Rasterise an SVG string to a PNG Blob entirely in the browser, with no
 * server round-trip.
 *
 * 3×, not 2×: at the default 22px cell a single-column journal figure comes
 * out around 500 CSS px wide, which 2× rasterises to ~3.4in at 300 dpi — under
 * the 85mm single-column width most publishers ask for. 3× clears it, and
 * still lands well inside the clipboard's practical size.
 */
async function svgToPngBlob(svg: string, scale = 3): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
  });
}

/** Download the grid as a heatmap image, mirroring the on-screen display options. */
function HeatmapExports({
  authors,
  monoColor,
  showLevels,
  transpose,
  acronyms,
}: {
  authors: Author[];
  monoColor: string;
  showLevels: boolean;
  transpose: boolean;
  acronyms: boolean;
}) {
  const { translateRole, translateUi } = useCreditTranslators();
  const t = useTranslations();
  const [loading, setLoading] = useState<ExportFormat | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, copy] = useCopyStatus({
    copied: t("annHeatmapCopied"),
  });

  function renderSvg() {
    return buildHeatmapSvg(authors, { transpose, monoColor, showLevels, acronyms, translateRole, translateUi });
  }

  function fail(format: ExportFormat) {
    const message = t("errHeatmapExport", { format: format.toUpperCase() });
    setError(message);
    announce(message, { assertive: true });
  }

  async function download(format: ExportFormat) {
    setLoading(format);
    setError(null);
    try {
      const svg = renderSvg();
      if (format === "svg") {
        downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "credit-heatmap.svg");
      } else {
        downloadBlob(await svgToPngBlob(svg), "credit-heatmap.png");
      }
    } catch {
      fail(format);
    } finally {
      setLoading(null);
    }
  }

  // Copy the image bytes (not a URL) so it pastes straight into a doc or slide,
  // the same move the CRediT badge makes. PNG, because that is what editors take.
  async function copyPng() {
    setLoading("copy");
    setError(null);
    try {
      // useCopyStatus owns the status, the announce and the 2s reset; this only
      // supplies the clipboard write and the inline error text.
      await copy(async () => {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": svgToPngBlob(renderSvg()) })]);
      });
    } finally {
      setLoading(null);
    }
  }

  return (
    // The error gets its own full-width line under the buttons instead of a
    // 120px truncation: the hover-title fallback was unreachable on touch.
    <div className="flex shrink-0 flex-col items-end gap-1">
      {/* No visible "HEATMAP" label: the group's accessible name carries it,
          and the freed width is what keeps the legend beside it on one line. */}
      <fieldset aria-label={t("heatmapLabel")} className="flex items-center gap-2">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => void copyPng()}
          title={t("copyHeatmapHint")}
          className="flex items-center gap-1.5 px-2.5 py-1 border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary rounded-lg text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Copy className="h-3.5 w-3.5" />
          {copyStatus === "copied" ? t("copied") : copyStatus === "error" ? t("copyFailedMessage") : t("copy")}
        </button>
        {(["svg", "png"] as ExportFormat[]).map((format) => (
          <button
            key={format}
            type="button"
            disabled={loading !== null}
            onClick={() => download(format)}
            className="flex items-center gap-1.5 px-2.5 py-1 border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary rounded-lg text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            {loading === format ? "…" : format.toUpperCase()}
          </button>
        ))}
      </fieldset>
      {error && <span className="max-w-56 text-right text-[11px] text-error">{error}</span>}
    </div>
  );
}
