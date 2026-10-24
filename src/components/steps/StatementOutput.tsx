"use client";

import { Check, CheckCircle2, ChevronDown, Copy, Download, Info, Settings2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { CreditBadge } from "@/components/ui/credit-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  type Author,
  CREDIT_ROLES,
  generateStatement,
  type StatementFormat,
  toCsv,
  toJats4rXml,
  toJson,
  toMarkdown,
  toTenzing,
} from "@/core";
import { isAllBinary, rolesWithContributions } from "@/core/author";
import type { RoleTranslator, UiTranslator } from "@/core/i18n";
import { validateContributions } from "@/core/validate";
import { copyRichText } from "@/lib/copy-rich-text";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useSettled } from "@/lib/use-settled";
import { download } from "@/lib/utils";
import { useAskSummary, useContributionStore } from "@/store/contribution-store";

type DataFormat = "xml" | "json" | "csv" | "tenzing" | "markdown";

const EXPORT_ITEM_BUTTON =
  "flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** Machine-readable export formats, each able to be copied or downloaded. */
const DATA_FORMATS: Record<
  DataFormat,
  {
    label: string;
    serialize: (authors: Author[], translateRole: RoleTranslator, translateUi: UiTranslator, locale: string) => string;
    filename: string;
    mime: string;
  }
> = {
  // XML/JSON/CSV/tenzing are machine round-trip formats, kept in canonical English.
  // Only Markdown (a human-facing paste artifact) follows the output language.
  // XML and JSON are replaced per export in the component, which knows the
  // input mode and whether answers go in.
  xml: {
    label: "XML (JATS4R)",
    serialize: (authors) => toJats4rXml(authors),
    filename: "credit-contributors.xml",
    mime: "application/xml",
  },
  json: {
    label: "JSON",
    serialize: (authors) => toJson(authors),
    filename: "credit_result.json",
    mime: "application/json",
  },
  csv: { label: "CSV", serialize: toCsv, filename: "credit_result.csv", mime: "text/csv;charset=utf-8" },
  tenzing: {
    label: "tenzing CSV",
    serialize: toTenzing,
    filename: "tenzing-contributors.csv",
    mime: "text/csv;charset=utf-8",
  },
  markdown: {
    label: "Markdown",
    serialize: toMarkdown,
    filename: "credit-contributors.md",
    mime: "text/markdown;charset=utf-8",
  },
};

export function StatementOutput() {
  const authors = useContributionStore((s) => s.authors);
  const asks = useContributionStore((s) => s.asks);
  const selfId = useContributionStore((s) => s.selfId);
  const yesNo = useContributionStore((s) => s.inputMode === "toggle");
  const openReview = useContributionStore((s) => s.openReview);
  const openDifferences = useAskSummary().open;
  // Co-author answers travel in the JSON export by default: it is the backup and device-move format.
  const [includeAnswers, setIncludeAnswers] = useState(true);
  // Everyone asked, answered or not: the JSON export carries the ask history too.
  const askedCount = authors.filter((author) => author.id in asks).length;
  const { translateRole, translateUi, translateInterfaceRole, outputLanguage } = useCreditTranslators();
  const t = useTranslations();
  // Last beat of the population sequence; see .enter-fade in globals.css.
  const settled = useSettled();
  const [copyStatus, copyText] = useCopyStatus({
    copied: t("annStatementCopied"),
  });
  // Separate status for the data-format Copy button, so feedback appears on
  // the button that was clicked rather than on the main statement copy.
  const [dataCopyStatus, copyDataText] = useCopyStatus({
    copied: t("annExportDataCopied"),
  });
  // Which format the shared copy status belongs to, so feedback lands on that row.
  const [copiedFormat, setCopiedFormat] = useState<DataFormat>("xml");
  // Statement-local output controls (independent of the heatmap's).
  const [grouping, setGrouping] = useState<"by-author" | "by-role">("by-author");
  const [acronyms, setAcronyms] = useState(false);
  const [showLevels, setShowLevels] = useState(false);
  const [separateAck, setSeparateAck] = useState(true);

  const format: StatementFormat =
    grouping === "by-role" ? (acronyms ? "by-role-short" : "by-role") : acronyms ? "by-author-short" : "by-author";

  const statementOptions = {
    format,
    showLevels,
    translateRole,
    translateUi,
    locale: outputLanguage,
    separateAcknowledgements: separateAck,
  };
  const statement = generateStatement(authors, statementOptions);
  const issues = validateContributions(authors);
  const hasAuthors = authors.length > 0;
  const assignedRoleCount = rolesWithContributions(authors).length;
  const isReady = Boolean(statement) && issues.length === 0;
  // Levels only mean something when contributions aren't purely binary.
  const canShowLevels = !isAllBinary(authors);
  // The split control only matters once someone is marked a non-author contributor.
  const hasNonAuthors = authors.some((author) => author.contributorType === "non-author");

  function serialize(dataFormat: DataFormat): string {
    if (dataFormat === "json") return toJson(authors, { asks, includeAnswers, selfId });
    if (dataFormat === "xml") return toJats4rXml(authors, { yesNo });
    return DATA_FORMATS[dataFormat].serialize(authors, translateRole, translateUi, outputLanguage);
  }

  function downloadData(dataFormat: DataFormat) {
    if (!hasAuthors) return;
    const { filename, mime } = DATA_FORMATS[dataFormat];
    // A BOM makes Excel read the file as UTF-8, so non-ASCII names survive.
    const bom = dataFormat === "csv" || dataFormat === "tenzing" ? "﻿" : "";
    download(new Blob([bom, serialize(dataFormat)], { type: mime }), filename);
  }

  function goToReview() {
    openReview(null);
    requestAnimationFrame(() => document.getElementById("inspector-tab-review")?.focus());
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Says the statement is the lead's version; never blocks copying it. */}
      {openDifferences > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-primary/10 px-3 py-2 text-[13px] text-on-surface">
          <span className="flex-1">{t("statementDiffers", { count: openDifferences })}</span>
          <button
            type="button"
            onClick={goToReview}
            className="min-h-6 rounded px-1 font-semibold text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("reviewAction")}
          </button>
        </p>
      )}
      {/* One non-wrapping cluster, so the gear never dangles alone. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <SegmentedControl
            ariaLabel={t("a11yStatementGrouping")}
            size="sm"
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: "by-author", label: t("groupByAuthor") },
              { value: "by-role", label: t("groupByRole") },
            ]}
          />
          {/* The grouping is the statement's mode and stays visible; the wording
            toggles are display options and live behind the same icon-only gear
            the heatmap's options use. Conditional toggles appearing inside the
            popover can no longer reflow this row. */}
          <Popover>
            <PopoverTrigger
              aria-label={t("statementOptions")}
              title={t("statementOptions")}
              className="flex size-9 items-center justify-center rounded-lg border border-outline-variant/60 text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:border-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="end" aria-label={t("statementOptions")} className="grid w-60 gap-3">
              <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                <Switch checked={acronyms} onCheckedChange={setAcronyms} aria-label={t("a11yUseInitials")} />
                {t("useInitials")}
              </span>
              {canShowLevels && (
                <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <Switch checked={showLevels} onCheckedChange={setShowLevels} aria-label={t("a11yShowLevels")} />
                  {t("showLevels")}
                </span>
              )}
              {hasNonAuthors && (
                <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <Switch checked={separateAck} onCheckedChange={setSeparateAck} aria-label={t("a11ySeparateAcks")} />
                  {t("separateAcknowledgements")}
                </span>
              )}
            </PopoverContent>
          </Popover>
        </span>
      </div>

      {hasAuthors && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant" role="status">
          <span
            // Keyed on readiness so the flip remounts the chip and the house
            // entrance plays once — the quiet acknowledgment that the statement
            // is done. Gated on `settled` like every other entrance, so a
            // restored draft that is already ready stays still on load.
            key={isReady ? "ready" : "notes"}
            className={`inline-flex items-center gap-1.5 font-medium ${isReady ? "text-primary" : "text-on-surface"} ${
              settled ? "enter-rise" : ""
            }`}
          >
            {isReady ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : (
              <Info className="size-4" aria-hidden="true" />
            )}
            {isReady ? t("statusReady") : t("statusNotes", { count: issues.length })}
          </span>
          <span>{t("contributorCount", { count: authors.length })}</span>
          <span>{t("rolesUsed", { used: assignedRoleCount, total: CREDIT_ROLES.length })}</span>
        </div>
      )}

      {/* Statement preview */}
      {/* Sized to the statement, not to the pane: a short statement should not
          render as a tall empty box. It shrinks and scrolls only once the card
          runs out of room. tabIndex makes that overflow keyboard-reachable:
          the pane holds no focusable content of its own. */}
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region with no focusable content needs a tab stop, or keyboard users cannot reach the overflow (axe scrollable-region-focusable).
        tabIndex={0}
        aria-label={t("a11yGeneratedStatement")}
        // The statement is written in the *output* language, which need not be
        // the page's language. Declaring it lets a screen reader switch
        // pronunciation instead of reading Dutch with English rules.
        lang={outputLanguage}
        className="relative z-10 min-h-[3.5rem] border-l border-primary bg-surface-container-low p-3 rounded-r focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary desk:min-h-0 desk:overflow-y-auto"
        style={{ fontFamily: "var(--font-headline)" }}
      >
        {/* The keys are load-bearing, not React hygiene: both branches render a
            <p>, so without them React reconciles the placeholder into the
            statement in place and the element is never *newly* rendered —
            which is the one condition @starting-style needs to fire. */}
        {statement ? (
          <p
            key="statement"
            style={{ transitionDelay: "200ms" }}
            className={`max-w-[75ch] whitespace-pre-line [overflow-wrap:anywhere] text-base leading-relaxed text-on-surface ${
              settled ? "enter-fade" : ""
            }`}
          >
            {statement}
          </p>
        ) : (
          <p key="placeholder" className="text-sm text-on-surface-variant not-italic">
            {t("statementEmptyHint")}
          </p>
        )}
      </section>

      {/* Validation notices: a live region so changes are announced as authors edit. */}
      {issues.length > 0 && (
        <ul
          // biome-ignore lint/a11y/noNoninteractiveTabindex: same as the statement pane; the bounded notes list scrolls and holds no focusable content.
          tabIndex={0}
          className="relative z-10 flex max-h-40 flex-col gap-1.5 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("a11yStatementNotes")}
          aria-live="polite"
        >
          {issues.map((issue) => {
            const text =
              issue.code === "authorNoRoles"
                ? t("validationAuthorNoRoles", { name: issue.authorName })
                : t("validationRoleUnassigned", { role: translateInterfaceRole(issue.role) });
            return (
              <li
                // The id breaks ties: two contributors can share a name, and
                // then code+text alone collides (a real duplicate-key error).
                key={issue.code === "authorNoRoles" ? `${issue.code}-${issue.authorId}` : `${issue.code}-${issue.role}`}
                className={`flex items-start gap-2 text-xs rounded px-3 py-2 ${
                  issue.level === "warning"
                    ? "bg-error-container/30 text-error"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {issue.level === "warning" ? (
                  <TriangleAlert className="h-4 w-4 shrink-0 mt-px" />
                ) : (
                  <Info className="h-4 w-4 shrink-0 mt-px" />
                )}
                <span>{text}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Copy statement is the primary action; the data formats share one menu
          beside it, each with its own Copy and Download, so switching format
          costs no extra click. */}
      <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-3">
        <button
          type="button"
          onClick={() =>
            // The HTML flavour is built on demand: it is only ever needed at
            // the moment of the copy, never for the rendered pane.
            copyText(() => copyRichText(statement, generateStatement(authors, { ...statementOptions, asHtml: true })))
          }
          disabled={!statement}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none"
        >
          <Copy className="h-[18px] w-[18px]" aria-hidden="true" />
          {copyStatus === "copied" ? t("copied") : copyStatus === "error" ? t("copyFailedMessage") : t("copyStatement")}
        </button>

        <Popover>
          <PopoverTrigger
            disabled={!hasAuthors}
            className="flex min-h-10 items-center gap-1.5 rounded-lg border border-outline-variant px-3 text-sm font-medium text-on-surface transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:border-outline-variant/40 disabled:text-on-surface-variant/60 data-[state=open]:border-primary data-[state=open]:text-primary"
          >
            <Download className="size-4" aria-hidden="true" />
            {t("exportData")}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent align="start" aria-label={t("exportData")} className="w-72 max-w-[calc(100vw-2rem)] p-1">
            <ul aria-label={t("a11yExportFormat")} className="grid">
              {(Object.keys(DATA_FORMATS) as DataFormat[]).map((value) => {
                const { label } = DATA_FORMATS[value];
                const copiedThis = copiedFormat === value && dataCopyStatus !== "idle";
                return (
                  <li key={value} className="rounded-md py-0.5 pl-2 text-[13px] text-on-surface">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1">{label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCopiedFormat(value);
                          void copyDataText(serialize(value));
                        }}
                        aria-label={t("copyFormat", { format: label })}
                        title={t("copyFormat", { format: label })}
                        className={EXPORT_ITEM_BUTTON}
                      >
                        {copiedThis && dataCopyStatus === "copied" ? (
                          <Check className="size-3.5 text-primary" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3.5" aria-hidden="true" />
                        )}
                        {copiedThis ? (dataCopyStatus === "copied" ? t("copied") : t("copyFailedMessage")) : t("copy")}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadData(value)}
                        aria-label={t("downloadFormat", { format: label })}
                        title={t("downloadFormat", { format: label })}
                        className={EXPORT_ITEM_BUTTON}
                      >
                        <Download className="size-3.5" aria-hidden="true" />
                        {t("download")}
                      </button>
                    </div>
                    {/* Only JSON carries asks, so the choice sits on its row. */}
                    {value === "json" && askedCount > 0 && (
                      <label className="flex min-h-8 items-center gap-2 pr-2 text-xs text-on-surface-variant">
                        <input
                          type="checkbox"
                          checked={includeAnswers}
                          onChange={(event) => setIncludeAnswers(event.target.checked)}
                          className="size-4 shrink-0 accent-primary"
                        />
                        {t("exportIncludesAnswers", { count: askedCount })}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>

        {/* Its own left-aligned line: hung off the right edge it read as a
            dangling leftover of the export row rather than a quiet extra. */}
        <CreditBadge className="basis-full flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-primary transition-colors" />
      </div>
    </div>
  );
}
