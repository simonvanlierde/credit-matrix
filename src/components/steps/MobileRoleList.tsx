"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Author, CREDIT_ROLES } from "@/core";
import { heatCellColor, onColor } from "@/core/contributor-color";
import type { RoleDescriber, RoleTranslator } from "@/core/i18n";
import { useClaimLock } from "@/lib/use-claim-lock";
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
  translateInterfaceRole,
  describeRole,
  interfaceRoleLanguage,
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
  translateInterfaceRole: RoleTranslator;
  describeRole: RoleDescriber;
  interfaceRoleLanguage: string;
}) {
  const t = useTranslations();
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
            // scroll-mt clears the fixed header and the sticky contributor
            // picker when focus scrolls a row into view.
            <li key={role.name} className="flex min-h-14 scroll-mt-40 items-center gap-2 py-1.5">
              <span className="flex min-w-0 flex-1 items-center">
                <RoleInfo
                  role={role}
                  translateRole={translateInterfaceRole}
                  describeRole={describeRole}
                  language={interfaceRoleLanguage}
                  className="text-sm"
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
                      const fill = heatCellColor(heatmapMonoColor, graded ? score : 100, dark);
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
  );
}
