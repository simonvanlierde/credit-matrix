import { ListChecks } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { create } from "zustand";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Author, CREDIT_ROLES } from "@/core";
import type { RoleTranslator, UiTranslator } from "@/core/i18n";
import { announce } from "@/lib/announce";
import { useTranslations } from "@/lib/translations";
import { useContributionStore } from "@/store/contribution-store";
import { ICON_TOOL_BUTTON, LEVEL_KEY, MENU_ITEM } from "./grid-shared";

// "None" is what Clear does, so the bulk picker offers only the assignable levels.
export const ASSIGNABLE_LEVELS = LEVEL_KEY.filter(({ score }) => score > 0);
// Equal, not Lead: bulk-marking everyone as Lead overstates every one of them.
export const DEFAULT_BULK_LEVEL = 66;

/**
 * The roster before and after the last bulk action; shared, so a menu on any surface can start an
 * undo. `after` lets any other change to the roster drop it: undoing then would discard that edit.
 */
const useBulkSnapshot = create<{ snapshot: { before: Author[]; after: Author[] } | null }>(() => ({ snapshot: null }));
const setBulkUndo = (snapshot: { before: Author[]; after: Author[] } | null) => useBulkSnapshot.setState({ snapshot });

/** Run a bulk mutation with the roster snapshotted for undo; the grid shows the bar. */
export function useRunBulk() {
  const t = useTranslations();
  return function runBulk(action: () => void) {
    const before = useContributionStore.getState().authors;
    action();
    setBulkUndo({ before, after: useContributionStore.getState().authors });
    announce(t("bulkChangeApplied"));
  };
}

/** The level step of a bulk action: one button per assignable level. */
export function LevelChoice({ onPick, translateUi }: { onPick: (score: number) => void; translateUi: UiTranslator }) {
  const t = useTranslations();
  const labelId = useId();
  return (
    <fieldset aria-labelledby={labelId} className="grid gap-0.5">
      <p id={labelId} className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-on-surface-variant">
        {t("bulkAssignLevel")}
      </p>
      {ASSIGNABLE_LEVELS.map(({ key, score }) => (
        <button key={key} type="button" onClick={() => onPick(score)} className={MENU_ITEM}>
          {translateUi(key)}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The undo for the last bulk action, with the actions that take and restore
 * it. One click can rewrite fourteen assignments, so it earns the same undo
 * bar a row removal has.
 */
export function useBulkUndo() {
  const t = useTranslations();
  const loadAuthors = useContributionStore((s) => s.loadAuthors);
  const snapshot = useBulkSnapshot((s) => s.snapshot);
  const authors = useContributionStore((s) => s.authors);
  const bulkUndo = snapshot?.after === authors ? snapshot.before : null;
  const runBulk = useRunBulk();
  // Where focus goes when the undo strip closes under it.
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The snapshot is one draft's roster: undoing it after a switch, Reset or
  // Delete all would load it over other or cleared work.
  const activeDraftId = useContributionStore((s) => s.activeDraftId);
  const workspaceCleared = useContributionStore((s) => s.workspaceCleared);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs on draft switch and clear by design
  useEffect(() => setBulkUndo(null), [activeDraftId, workspaceCleared]);
  // Any other roster change ends the undo for good, even if a later change lands on the same roster.
  useEffect(() => {
    if (snapshot && snapshot.after !== authors) setBulkUndo(null);
  }, [snapshot, authors]);

  function undoBulk() {
    if (!bulkUndo) return;
    loadAuthors(bulkUndo);
    announce(t("annBulkUndone"));
    setBulkUndo(null);
  }

  return { bulkUndo, runBulk, undoBulk, triggerRef };
}

/** Assign or clear a whole contributor or a whole role in one go. */
export function BulkAssignMenu({
  authors,
  graded,
  translateUi,
  translateRole,
  runBulk,
  triggerRef,
}: {
  authors: Author[];
  graded: boolean;
  translateUi: UiTranslator;
  translateRole: RoleTranslator;
  runBulk: (action: () => void) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations();
  const setAllAuthorScores = useContributionStore((s) => s.setAllAuthorScores);
  const setRoleScores = useContributionStore((s) => s.setRoleScores);
  const [bulkAuthorId, setBulkAuthorId] = useState("");
  const [bulkRoleIndex, setBulkRoleIndex] = useState("0");
  const [bulkLevel, setBulkLevel] = useState(String(DEFAULT_BULK_LEVEL));

  const firstAuthor = authors[0];
  if (!firstAuthor) return null;
  const bulkAuthor = authors.find((author) => author.id === bulkAuthorId) ?? firstAuthor;
  const parsedBulkRoleIndex = Number.parseInt(bulkRoleIndex, 10);
  // Yes/no has one "assigned" value; levels asks which one.
  const assignScore = graded ? Number.parseInt(bulkLevel, 10) : 100;

  return (
    <Popover>
      <PopoverTrigger
        ref={triggerRef}
        aria-label={t("bulkAssign")}
        title={t("bulkAssign")}
        className={ICON_TOOL_BUTTON}
      >
        <ListChecks className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t("bulkAssign")} className="grid w-72 max-w-[calc(100vw-2rem)] gap-4">
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
        <fieldset aria-labelledby="bulk-one-role" className="grid gap-2 border-t border-outline-variant/30 pt-3">
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
                  {translateRole(role.name)}
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
  );
}

function BulkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-9 rounded border border-edge bg-surface-bright px-2 text-xs font-medium text-on-surface-variant transition-[color,box-shadow] hover:shadow-card hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </button>
  );
}
