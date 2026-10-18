"use client";

import { Info } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NORM_FIELDS, NORMS, normRows, POSITIONS, selfPosition } from "@/lib/field-norms";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { cn } from "@/lib/utils";
import { useContributionStore } from "@/store/contribution-store";

/**
 * How often published papers in a field give each role, by author position.
 *
 * Context only: it never fills, suggests or judges a cell. The grid stays the
 * team's account; this tab is what the published record looks like beside it.
 * The numbers are a table first (every value as text, read with its row and
 * column headers), with a thin bar under each value as the picture. Bars and
 * the user's column stay neutral: primary is for actions, and a colored value
 * would read as a target.
 */
export function NormsPanel() {
  const t = useTranslations();
  const format = useFormatter();
  const { translateInterfaceRole } = useCreditTranslators();
  const field = useContributionStore((s) => s.normsField);
  const setField = useContributionStore((s) => s.setNormsField);
  const self = useContributionStore((s) => selfPosition(s.authors, s.selfId));
  const position = self === "non-author" ? null : self;
  const labelId = useId();
  // A saved field the current file no longer lists counts as none picked, with a line saying so.
  const rows = normRows(field);
  // OpenAlex's field names, which have no translations.
  const fieldName = (chunks: ReactNode) => <span lang="en">{chunks}</span>;
  const entry = rows && field ? NORMS.fields[field] : undefined;
  const filesDate = NORMS.files_date
    ? format.dateTime(new Date(NORMS.files_date), { dateStyle: "medium", timeZone: "UTC" })
    : "";

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs leading-relaxed text-on-surface-variant">{t("normsIntro")}</p>
      <div className="grid gap-1.5 text-xs font-medium text-on-surface">
        <span id={labelId}>{t("normsField")}</span>
        <Select value={rows && field ? field : ""} onValueChange={setField}>
          <SelectTrigger aria-labelledby={labelId} className="min-h-9 w-full text-sm font-normal">
            <SelectValue placeholder={t("normsFieldPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {NORM_FIELDS.map((name) => (
              // The span, not the item, carries lang: the trigger shows a copy of the item's text.
              <SelectItem key={name} value={name} className="text-sm">
                {fieldName(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows && entry ? (
        <>
          <div className="flex gap-2 rounded-lg bg-surface-container-low p-3 text-xs leading-relaxed text-on-surface-variant">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div className="flex flex-col gap-1.5">
              <p className="text-on-surface">
                {t.rich("normsCoverage", {
                  articles: entry.articles,
                  field: field ?? "",
                  date: filesDate,
                  name: fieldName,
                })}
              </p>
              {NORMS.parser_f1 !== null && (
                <p>
                  {t("normsUnvalidated", {
                    tagged: NORMS.parser_f1_articles,
                    f1: format.number(NORMS.parser_f1, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                  })}
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-on-surface-variant">
            {self === "non-author"
              ? t("normsNonAuthor")
              : position
                ? t("normsYourPosition", { position })
                : t("normsNoSelf")}
          </p>

          <table className="w-full border-collapse text-xs">
            <caption className="mb-2 text-left text-xs font-semibold text-on-surface">{t("normsCaption")}</caption>
            <thead>
              <tr className="border-b border-outline-variant/60">
                <th scope="col" className="py-1.5 pr-2 text-left align-bottom font-medium text-on-surface-variant">
                  {t("normsRole")}
                </th>
                {POSITIONS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className={cn(
                      "w-[17%] px-1.5 py-1.5 text-right align-bottom font-medium text-on-surface-variant",
                      column === position && "rounded-t bg-on-surface/6 text-on-surface",
                    )}
                  >
                    {t("normsPosition", { position: column })}
                    {column === position && (
                      <span className="block text-[11px] font-semibold text-on-surface">{t("teamYou")}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.role} className="border-b border-outline-variant/30 last:border-b-0">
                  <th scope="row" className="py-1.5 pr-2 text-left align-top font-normal leading-snug text-on-surface">
                    {translateInterfaceRole(row.role)}
                  </th>
                  {POSITIONS.map((column) => {
                    const share = row.shares[column];
                    return (
                      <td
                        key={column}
                        className={cn("px-1.5 py-1.5 text-right align-top", column === position && "bg-on-surface/6")}
                      >
                        {share === null ? (
                          <>
                            <span aria-hidden="true" className="text-on-surface-variant">
                              –
                            </span>
                            <span className="sr-only">{t("normsTooFew")}</span>
                          </>
                        ) : (
                          <>
                            <span className="tabular-nums text-on-surface">
                              {format.number(share, { style: "percent" })}
                            </span>
                            <span aria-hidden="true" className="mt-1 block h-1 rounded-full bg-on-surface/10">
                              <span
                                className="block h-full rounded-full bg-on-surface-variant/35"
                                style={{ width: `${share * 100}%` }}
                              />
                            </span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-xs leading-relaxed text-on-surface-variant">
            {t("normsFootnote", {
              minArticles: NORMS.min_articles,
              minAuthors: NORMS.min_authors,
              snapshot: NORMS.snapshot,
              version: NORMS.dataset_version,
            })}
          </p>
        </>
      ) : (
        <p className="text-xs text-on-surface-variant">
          {field ? t.rich("normsFieldGone", { field, name: fieldName }) : t("normsEmpty")}
        </p>
      )}
    </div>
  );
}
