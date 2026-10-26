"use client";

import { ListChecks } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UNDO_WINDOW_MS } from "@/components/ui/undo-bar";
import { type Author, CREDIT_ROLES } from "@/core";
import type { RoleTranslator, UiTranslator } from "@/core/i18n";
import { announce } from "@/lib/announce";
import { useContributionStore } from "@/store/contribution-store";
import { ICON_TOOL_BUTTON, LEVEL_KEY } from "./grid-shared";

// "None" is what Clear does, so the bulk picker offers only the assignable levels.
export const ASSIGNABLE_LEVELS = LEVEL_KEY.filter(({ score }) => score > 0);
// Equal, not Lead: bulk-marking everyone as Lead overstates every one of them.
export const DEFAULT_BULK_LEVEL = 66;

/**
 * The roster as it stood before the last bulk action, with the actions that
 * take and restore it. One click can rewrite fourteen assignments, so it earns
 * the same undo bar a row removal has.
 */
export function useBulkUndo() {
  const t = useTranslations();
  const loadAuthors = useContributionStore((s) => s.loadAuthors);
  const [bulkUndo, setBulkUndo] = useState<Author[] | null>(null);
  // Where focus goes when the undo strip closes under it.
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!bulkUndo) return;
    const timer = window.setTimeout(() => setBulkUndo(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [bulkUndo]);

  // The snapshot is one draft's roster: undoing it after a switch, Reset or
  // Delete all would load it over other or cleared work.
  const activeDraftId = useContributionStore((s) => s.activeDraftId);
  const workspaceCleared = useContributionStore((s) => s.workspaceCleared);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs on draft switch and clear by design
  useEffect(() => setBulkUndo(null), [activeDraftId, workspaceCleared]);

  /** Run a bulk mutation with the roster snapshotted for undo. */
  function runBulk(action: () => void) {
    const before = useContributionStore.getState().authors;
    action();
    setBulkUndo(before);
    announce(t("bulkChangeApplied"));
  }

  // NOTE: restores the whole roster snapshot, so it also reverts any edit made
  // inside the undo window — simple last-state undo, not an operation log.
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
      className="min-h-9 rounded-lg border border-outline-variant/60 px-2 text-xs font-medium text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </button>
  );
}
