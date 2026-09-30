"use client";

import { CheckCircle2, Copy, Download, Info, Settings2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { CreditBadge } from "@/components/ui/credit-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StepHeader } from "@/components/ui/step-header";
import { Switch } from "@/components/ui/switch";
import type { Author, RoleTranslator, StatementFormat, UiTranslator } from "@/core";
import {
  CREDIT_ROLES,
  generateStatement,
  isAllBinary,
  rolesWithContributions,
  toCsv,
  toJats4rXml,
  toJson,
  toMarkdown,
  validateContributions,
} from "@/core";
import { copyRichText } from "@/lib/copy-rich-text";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useSettled } from "@/lib/use-settled";
import { download } from "@/lib/utils";
import { useContributionStore } from "@/store/contribution-store";

type DataFormat = "xml" | "json" | "csv" | "markdown";

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
  // XML/JSON/CSV are machine round-trip formats, kept in canonical English.
  // Only Markdown (a human-facing paste artifact) follows the output language.
  xml: { label: "XML (JATS4R)", serialize: toJats4rXml, filename: "credit-contributors.xml", mime: "application/xml" },
  json: { label: "JSON", serialize: toJson, filename: "credit_result.json", mime: "application/json" },
  csv: { label: "CSV", serialize: toCsv, filename: "credit_result.csv", mime: "text/csv;charset=utf-8" },
  markdown: {
    label: "Markdown",
    serialize: toMarkdown,
    filename: "credit-contributors.md",
    mime: "text/markdown;charset=utf-8",
  },
};

export function StatementOutput() {
  const { authors } = useContributionStore();
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
  const [dataFormat, setDataFormat] = useState<DataFormat>("xml");
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

  function downloadData() {
    if (!hasAuthors) return;
    const { serialize, filename, mime } = DATA_FORMATS[dataFormat];
    // A BOM makes Excel read the file as UTF-8, so non-ASCII names survive.
    const bom = dataFormat === "csv" ? "﻿" : "";
    download(new Blob([bom, serialize(authors, translateRole, translateUi, outputLanguage)], { type: mime }), filename);
  }

  return (
    <div className="bg-surface-bright rounded-lg shadow-md border border-outline-variant/10 p-3 md:p-4 flex flex-col gap-3 desk:h-full desk:overflow-y-auto">
      {/* One left-aligned wrapping row: a conditional toggle extends the row
          instead of reflowing a justified cluster, so nothing jumps around. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StepHeader n={3} title={t("statementExportLabel")} className="mr-2" />
        {/* One non-wrapping cluster: when the column is narrow the pair moves
            below the heading together, and the gear never dangles alone. */}
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
            <PopoverContent align="end" className="grid w-60 gap-3">
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

      {/* One action row: copy the statement (primary), export a data format, and
          the badge anchored at the right. The groups wrap onto their own lines
          in the narrow 2xl column, so the t("exportData") label carries the
          separation rather than a divider that would be left orphaned. */}
      <div className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-3">
        <button
          type="button"
          onClick={() =>
            // The HTML flavour is built on demand: it is only ever needed at
            // the moment of the copy, never for the rendered pane.
            copyText(() => copyRichText(statement, generateStatement(authors, { ...statementOptions, asHtml: true })))
          }
          disabled={!statement}
          className="inline-flex items-center justify-center gap-2 px-5 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:bg-primary-container transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Copy className="h-[18px] w-[18px]" />
          {copyStatus === "copied" ? t("copied") : copyStatus === "error" ? t("copyFailedMessage") : t("copyStatement")}
        </button>

        {/* Secondary: pick a data format, then copy or download it */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">{t("exportData")}</span>
          {/* The label sits above so it stops competing for the row's width and
              leaving Download dangling on its own line. The controls still wrap
              on a phone, where three of them genuinely do not fit one line. */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dataFormat} onValueChange={(value) => setDataFormat(value as DataFormat)}>
              <SelectTrigger className="w-32 py-1.5 text-xs" aria-label={t("a11yExportFormat")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DATA_FORMATS) as DataFormat[]).map((value) => (
                  <SelectItem key={value} value={value} className="text-sm">
                    {DATA_FORMATS[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              type="button"
              onClick={() =>
                copyDataText(DATA_FORMATS[dataFormat].serialize(authors, translateRole, translateUi, outputLanguage))
              }
              disabled={!hasAuthors}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Copy className="h-3.5 w-3.5" />
              {dataCopyStatus === "copied"
                ? t("copied")
                : dataCopyStatus === "error"
                  ? t("copyFailedMessage")
                  : t("copy")}
            </button>

            <button
              type="button"
              onClick={downloadData}
              disabled={!hasAuthors}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3.5 w-3.5" />
              {t("download")}
            </button>
          </div>
        </div>

        {/* Its own left-aligned line: hung off the right edge it read as a
            dangling leftover of the export row rather than a quiet extra. */}
        <CreditBadge className="basis-full flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-primary transition-colors" />
      </div>
    </div>
  );
}
