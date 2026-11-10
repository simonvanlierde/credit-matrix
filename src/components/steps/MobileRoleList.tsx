import { useState } from "react";
import { InitialsChip } from "@/components/ui/initials-chip";
import { LevelMark } from "@/components/ui/level-mark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Author, CREDIT_ROLES } from "@/core";
import { heatCellColor, onColor } from "@/core/contributor-color";
import { useTranslations } from "@/lib/translations";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { RoleInfo } from "./RoleInfo";

/**
 * The matrix below the md breakpoint: one contributor at a time, picked from a
 * list, with their fourteen roles as rows.
 */
export function MobileRoleList({
  authors,
  graded,
  heatmapMonoColor,
  dark,
  settled,
  isFrozen,
  assignmentLabel,
  levelLabel,
  handleCellClick,
}: {
  authors: Author[];
  graded: boolean;
  heatmapMonoColor: string;
  dark: boolean;
  settled: boolean;
  isFrozen: (authorId: string) => boolean;
  assignmentLabel: (author: Author, roleIndex: number, score: number) => string;
  levelLabel: (score: number) => string;
  handleCellClick: (author: Author, roleIndex: number, score: number) => void;
}) {
  const t = useTranslations();
  const { translateInterfaceRole, describeRole, interfaceRoleLanguage } = useCreditTranslators();
  const { locked, editableAuthorId } = useClaimLock();
  const [selectedAuthorId, setSelectedAuthorId] = useState("");

  const firstAuthor = authors[0];
  if (!firstAuthor) return null;
  // On a locked draft the only editable row is the claimee's, so open there
  // rather than on whoever happens to sort first.
  const selectedAuthor =
    authors.find((author) => author.id === selectedAuthorId) ??
    (locked ? authors.find((author) => author.id === editableAuthorId) : undefined) ??
    firstAuthor;

  return (
    <div className={`md:hidden ${settled ? "enter-fade" : ""}`} style={{ transitionDelay: "120ms" }}>
      <div className="sticky top-13 z-20 -mx-1 mb-2 bg-surface-bright px-1 py-2">
        <label className="mb-1.5 block text-xs font-semibold text-on-surface" htmlFor="mobile-contributor">
          {t("contributorToAssign")}
        </label>
        <Select value={selectedAuthor.id} onValueChange={setSelectedAuthorId}>
          {/* Touch size: this picker decides whose roles the 44px buttons below change. */}
          <SelectTrigger id="mobile-contributor" size="touch" className="w-full" aria-label={t("contributorToAssign")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-(--radix-select-trigger-width)">
            {authors.map((author) => (
              <SelectItem key={author.id} value={author.id} textValue={author.name} size="touch">
                {/* Inside the item text, so the trigger shows the chip too. */}
                <span className="flex min-w-0 items-center gap-2">
                  <InitialsChip author={author} />
                  <span className="truncate">{author.name}</span>
                </span>
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
            // The scroll margin sits on the focusable buttons: focus scrolling
            // uses the focused element's own, to clear the fixed header and the
            // sticky contributor picker (header 52px + picker 84px).
            <li key={role.name} className="flex min-h-14 items-center gap-2 py-1.5">
              <span className="flex min-w-0 flex-1 items-center">
                <RoleInfo
                  role={role}
                  translateRole={translateInterfaceRole}
                  describeRole={describeRole}
                  language={interfaceRoleLanguage}
                  className="scroll-mt-36 text-sm"
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
                className={`contribution-cell scroll-mt-36 flex min-h-11 min-w-24 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-surface-container-high px-3 text-xs font-semibold transition-[background-color,box-shadow] duration-[120ms] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                  score > 0 ? "text-on-surface shadow-sm" : "text-on-surface-variant"
                }`}
              >
                {/* The label never sits on the dynamic fill: a mid-tone
                  preset has no 4.5:1 text companion at all, and the
                  palette is user-picked. The swatch carries the color;
                  its mark needs only the 3:1 non-text ratio, which
                  onColor guarantees. */}
                {score > 0 && (
                  <span
                    aria-hidden="true"
                    className="flex size-5 shrink-0 items-center justify-center rounded"
                    style={(() => {
                      const fill = heatCellColor(heatmapMonoColor, graded ? score : 100, dark);
                      return { backgroundColor: fill, color: onColor(fill) };
                    })()}
                  >
                    <LevelMark score={score} graded={graded} color="currentColor" size="small" />
                  </span>
                )}
                {levelLabel(score)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
