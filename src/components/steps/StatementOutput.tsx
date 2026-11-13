import { CheckCircle2, ChevronDown, Copy, Download, Info, Settings2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { CreditBadge } from "@/components/ui/credit-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingSwitch, SettingsPanel, SettingsSection } from "@/components/ui/settings-panel";
import { CREDIT_ROLES, type CreditRoleName, generateStatement, type StatementFormat, statementSpans } from "@/core";
import { isAllBinary } from "@/core/author";
import { pageMarkColor } from "@/core/contributor-color";
import { TOOLCHAINS, type Toolchain } from "@/core/toolchain";
import { validateContributions } from "@/core/validate";
import { copyRichText } from "@/lib/copy-rich-text";
import { DATA_FORMATS, type DataFormat } from "@/lib/data-exports";
import { useTranslations } from "@/lib/translations";
import { useContributorHue } from "@/lib/use-contributor-hue";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useDark } from "@/lib/use-dark";
import { useHeatmapSettings } from "@/lib/use-heatmap-settings";
import { useSettled } from "@/lib/use-settled";
import { download } from "@/lib/utils";
import { DEFAULT_STATEMENT_OPTIONS, useAskSummary, useContributionStore } from "@/store/contribution-store";
import { useGuide } from "@/store/guide-store";
import { EXPORT_BUTTON, ICON_TOOL_BUTTON } from "./grid-shared";
import { HeatmapExports } from "./HeatmapExports";
import { EXPORT_ITEM_BUTTON, OutputActions, OutputBlock } from "./OutputBlock";
import { PersonMenu } from "./PersonMenu";
import { RoleInfo } from "./RoleInfo";
import { TOOLCHAIN_OUTPUTS, ToolchainPanel } from "./ToolchainPanel";

/** A name or role in the running text that opens a panel: it keeps the text's look, not a button's. */
/**
 * A name or role in the statement: text, not a control. A click opens the same menu its real
 * trigger does (the list row's "…", the grid header), which is the keyboard's way in; as buttons,
 * every name would be a tab stop and the statement would read as a row of buttons.
 */
const NAME_TEXT =
  "cursor-pointer underline decoration-outline/50 decoration-dotted underline-offset-4 hover:text-primary hover:decoration-primary";

export function StatementOutput() {
  const toolchain = useContributionStore((s) => s.toolchain);
  const setToolchain = useContributionStore((s) => s.setToolchain);
  const toolchainId = useId();
  const authors = useContributionStore((s) => s.authors);
  const asks = useContributionStore((s) => s.asks);
  const selfId = useContributionStore((s) => s.selfId);
  const yesNo = useContributionStore((s) => s.inputMode === "toggle");
  const heatmapSettings = useHeatmapSettings(!yesNo);
  const openReview = useContributionStore((s) => s.openReview);
  const statementLink = useContributionStore((s) => s.statementLink);
  const setStatementLink = useContributionStore((s) => s.setStatementLink);
  // The linked phrase takes its contributor's hue, matching their cell.
  const contributorHue = useContributorHue(statementLink?.contributorId);
  const dark = useDark();
  const linkHue = contributorHue ? pageMarkColor(contributorHue, dark) : null;
  const openDifferences = useAskSummary().open;
  // Co-author answers travel in the JSON export by default: it is the backup and device-move format.
  const [includeAnswers, setIncludeAnswers] = useState(true);
  // Everyone asked, answered or not: the JSON export includes the ask history too.
  const askedCount = authors.filter((author) => author.id in asks).length;
  const { translateRole, translateUi, translateInterfaceRole, describeRole, interfaceRoleLanguage, outputLanguage } =
    useCreditTranslators();
  const t = useTranslations();
  const toolchainOutput = toolchain ? TOOLCHAIN_OUTPUTS[toolchain].format : null;
  // Last beat of the population sequence; see .enter-fade in globals.css.
  const settled = useSettled();
  const [copyStatus, copyText] = useCopyStatus({
    copied: t("annStatementCopied"),
  });
  // The last step of the getting-started list: the statement has left the page once.
  const markGuideCopied = useGuide((state) => state.markCopied);
  useEffect(() => {
    if (copyStatus === "copied") markGuideCopied();
  }, [copyStatus, markGuideCopied]);
  // Statement-local output controls (independent of the heatmap's).
  const [grouping, setGrouping] = useState<"by-author" | "by-role">("by-author");
  const { initials: acronyms, showLevels, separateAck } = useContributionStore((s) => s.statementOptions);
  const setStatementOptions = useContributionStore((s) => s.setStatementOptions);

  const format: StatementFormat =
    grouping === "by-role" ? (acronyms ? "by-role-short" : "by-role") : acronyms ? "by-author-short" : "by-author";

  const statementOptions = useMemo(
    () => ({
      format,
      showLevels,
      translateRole,
      translateUi,
      locale: outputLanguage,
      separateAcknowledgements: separateAck,
    }),
    [format, showLevels, translateRole, translateUi, outputLanguage, separateAck],
  );
  const statement = useMemo(() => generateStatement(authors, statementOptions), [authors, statementOptions]);
  const issues = useMemo(() => validateContributions(authors), [authors]);
  const hasAuthors = authors.length > 0;
  const isReady = Boolean(statement) && issues.length === 0;
  // Levels only mean something when contributions aren't purely binary.
  const canShowLevels = !isAllBinary(authors);
  // The split control only matters once someone is marked a non-author contributor.
  const hasNonAuthors = authors.some((author) => author.contributorType === "non-author");

  const exportOptions = useMemo(
    () => ({ asks, includeAnswers, selfId, toolchain, yesNo, translateRole, translateUi, outputLanguage }),
    [asks, includeAnswers, selfId, toolchain, yesNo, translateRole, translateUi, outputLanguage],
  );

  const answersChoice = askedCount > 0 && (
    <label className="flex min-h-8 items-center gap-2 pr-2 text-xs text-on-surface-variant">
      <input
        type="checkbox"
        checked={includeAnswers}
        onChange={(event) => setIncludeAnswers(event.target.checked)}
        className="size-4 shrink-0 accent-primary"
      />
      {t("exportIncludesAnswers", { count: askedCount })}
    </label>
  );

  function exportRow(value: DataFormat) {
    return (
      <li key={value} className="py-0.5 text-[13px] text-on-surface">
        <OutputActions authors={authors} format={value} options={exportOptions} />
        {value === "json" && answersChoice}
      </li>
    );
  }

  // Only the statement's own mark: a cell may have taken over before this leave event lands.
  function clearPhraseLink() {
    const from = useContributionStore.getState().statementLink?.from;
    if (from === "phrase" || from === "name" || from === "role") setStatementLink(null);
  }

  /** Focus a phrase's cell in the grid (which makes it the grid's tab stop) and bring it into view. */
  function goToCell(authorId: string, role: string) {
    const cell = document.querySelector<HTMLElement>(
      `[data-cell-key="${authorId}:${CREDIT_ROLES.findIndex((candidate) => candidate.name === role)}"]`,
    );
    cell?.focus();
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function goToReview() {
    openReview(null);
    requestAnimationFrame(() => document.getElementById("inspector-tab-review")?.focus());
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={toolchainId} className="text-xs font-semibold">
          {t("toolchainLabel")}
        </label>
        <Select
          value={toolchain ?? "none"}
          onValueChange={(value) => setToolchain(value === "none" ? undefined : (value as Toolchain))}
        >
          <SelectTrigger id={toolchainId} className="min-h-9 max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("toolchainNone")}</SelectItem>
            {TOOLCHAINS.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "markdown"
                  ? t("toolchainMarkdown")
                  : value === "myst"
                    ? t("toolchainMyst")
                    : TOOLCHAIN_OUTPUTS[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Says the statement is the lead's version; never blocks copying it. */}
      {openDifferences > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-primary/10 px-3 py-2 text-[13px] text-on-surface">
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
              className={ICON_TOOL_BUTTON}
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="end" aria-label={t("statementOptions")} className="w-72 max-w-[calc(100vw-2rem)]">
              <SettingsPanel
                title={t("statementOptions")}
                onReset={() => setStatementOptions(DEFAULT_STATEMENT_OPTIONS)}
              >
                <SettingsSection>
                  <SettingSwitch
                    label={t("useInitials")}
                    checked={acronyms}
                    onChange={(initials) => setStatementOptions({ initials })}
                    ariaLabel={t("a11yUseInitials")}
                  />
                  {canShowLevels && (
                    <SettingSwitch
                      label={t("showLevels")}
                      checked={showLevels}
                      onChange={(next) => setStatementOptions({ showLevels: next })}
                      ariaLabel={t("a11yShowLevels")}
                    />
                  )}
                  {hasNonAuthors && (
                    <SettingSwitch
                      label={t("separateAcknowledgements")}
                      checked={separateAck}
                      onChange={(next) => setStatementOptions({ separateAck: next })}
                      ariaLabel={t("a11ySeparateAcks")}
                    />
                  )}
                </SettingsSection>
              </SettingsPanel>
            </PopoverContent>
          </Popover>
        </span>
      </div>

      {hasAuthors && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
          <span role="status">
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
          </span>
        </div>
      )}

      {/* Statement preview */}
      {/* Sized to the statement, not to the pane: a short statement should not
          render as a tall empty box. It shrinks and scrolls only once the card
          runs out of room. tabIndex makes that overflow keyboard-reachable:
          the pane holds no focusable content of its own. */}
      <section
        tabIndex={statement ? 0 : undefined}
        aria-label={t("a11yGeneratedStatement")}
        // The statement is written in the *output* language, which need not be
        // the page's language. Declaring it lets a screen reader switch
        // pronunciation instead of reading Dutch with English rules.
        lang={outputLanguage}
        // A page of the manuscript: paper on the tinted page, an ink edge and the sheet shadow.
        className="relative z-10 mr-1.5 mb-1.5 min-h-[3.5rem] rounded-sm border border-edge bg-surface-bright px-5 py-4 shadow-sheet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary desk:min-h-0 desk:overflow-y-auto"
        style={{ fontFamily: "var(--font-headline)" }}
      >
        {/* The keys are load-bearing, not React hygiene: both branches render a
            <p>, so without them React reconciles the placeholder into the
            statement in place and the element is never *newly* rendered —
            which is the one condition @starting-style needs to fire. */}
        {statement ? (
          // biome-ignore lint/a11y/useKeyWithClickEvents: pointer shortcut; a keyboard reaches the same cell through the grid's arrow keys.
          <p
            key="statement"
            // Pointer only: a keyboard marks the same phrase by focusing its cell in the grid.
            onPointerOver={(event) => {
              // A tap sends no leave, so its mark would stay; the grid and list give touch the same links.
              if (event.pointerType === "touch") return;
              const target = event.target as HTMLElement;
              const phrase = target.closest<HTMLElement>("[data-author]");
              const { author, role } = phrase?.dataset ?? {};
              const roleName = target.closest<HTMLElement>("[data-role-name]")?.dataset.roleName;
              if (author && role)
                setStatementLink({ contributorId: author, role: role as CreditRoleName, from: "phrase" });
              else if (author) setStatementLink({ contributorId: author, from: "name" });
              else if (roleName) setStatementLink({ role: roleName as CreditRoleName, from: "role" });
              else clearPhraseLink();
            }}
            onPointerLeave={clearPhraseLink}
            // A click on a phrase (one person's one role) goes to its cell in the grid.
            onClick={(event) => {
              const phrase = (event.target as HTMLElement).closest<HTMLElement>("[data-author][data-role]");
              // Not while a selection is being made across the text.
              if (phrase?.dataset.author && phrase.dataset.role && window.getSelection()?.isCollapsed !== false)
                goToCell(phrase.dataset.author, phrase.dataset.role);
            }}
            style={{ transitionDelay: "200ms" }}
            className={`max-w-[75ch] whitespace-pre-line [overflow-wrap:anywhere] text-[17px] leading-relaxed text-on-surface ${
              settled ? "enter-fade" : ""
            }`}
          >
            {statementSpans(authors, statementOptions).map((span, spanIndex) => {
              const authorId = span.cell?.authorId ?? span.authorId;
              if (span.role) {
                // A role's name in a by-role statement: the same popover as the grid's role label.
                const roleInfo = CREDIT_ROLES.find((candidate) => candidate.name === span.role);
                if (!roleInfo) return span.text;
                return (
                  <RoleInfo
                    // biome-ignore lint/suspicious/noArrayIndexKey: the same role heads the CRediT and Acknowledgements lines
                    key={`role:${span.role}:${spanIndex}`}
                    role={roleInfo}
                    translateRole={translateInterfaceRole}
                    describeRole={describeRole}
                    language={interfaceRoleLanguage}
                    textAnchor
                    trigger={
                      <span data-role-name={span.role} className={NAME_TEXT}>
                        {span.text}
                      </span>
                    }
                  />
                );
              }
              if (!authorId) return span.text;
              const role = span.cell?.role;
              // A person link (no role) marks their name and every phrase, a role link (no person)
              // that role's phrase for everyone, and a cell link its one phrase.
              const linked =
                statementLink !== null &&
                (statementLink.contributorId ?? authorId) === authorId &&
                (statementLink.role === undefined
                  ? statementLink.contributorId !== undefined
                  : statementLink.role === role);
              const markClass =
                "rounded-sm [box-decoration-break:clone] data-linked:bg-primary/20 data-linked:underline data-linked:decoration-primary data-linked:decoration-2 data-linked:underline-offset-[3px]";
              const markStyle =
                linked && linkHue
                  ? {
                      backgroundColor: `color-mix(in oklab, ${linkHue} 18%, transparent)`,
                      textDecorationColor: linkHue,
                    }
                  : undefined;
              // A person's name opens their menu, as the grid's name header does.
              if (!role) {
                return (
                  <PersonMenu
                    key={`${authorId}:`}
                    authorId={authorId}
                    surface="statement"
                    textAnchor
                    trigger={
                      <span
                        data-author={authorId}
                        data-linked={linked || undefined}
                        className={`${NAME_TEXT} ${markClass}`}
                        style={markStyle}
                      >
                        {span.text}
                      </span>
                    }
                  />
                );
              }
              // One element either way: swapping in a <mark> would remount the text and break a
              // selection being dragged across it. Underlined as well as tinted, never colour alone.
              return (
                <span
                  key={`${authorId}:${role}`}
                  data-author={authorId}
                  data-role={role}
                  data-linked={linked || undefined}
                  className={`cursor-pointer ${markClass}`}
                  style={markStyle}
                >
                  {span.text}
                </span>
              );
            })}
          </p>
        ) : (
          <p key="placeholder" className="text-sm text-on-surface-variant not-italic">
            {t("statementEmptyHint")}
          </p>
        )}
      </section>

      {/* Validation notices. Not a live region: the readiness chip above already says
          how many there are, and a list that arrived with its text was read a second time.
          All in the note style: none of them blocks copying or exporting, so a draft
          still being filled in is not shown as an error. */}
      {issues.length > 0 && (
        <ul
          // biome-ignore lint/a11y/noNoninteractiveTabindex: same as the statement pane; the bounded notes list scrolls and holds no focusable content.
          tabIndex={0}
          className="relative z-10 flex max-h-40 flex-col gap-1.5 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("a11yStatementNotes")}
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
                className="flex items-start gap-2 text-xs rounded px-3 py-2 bg-surface-container-high text-on-surface-variant"
              >
                <Info className="h-4 w-4 shrink-0 mt-px" aria-hidden="true" />
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
          data-guide-target="copy"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded bg-primary shadow-press px-5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none"
        >
          <Copy className="h-[18px] w-[18px]" aria-hidden="true" />
          {copyStatus === "copied" ? t("copied") : copyStatus === "error" ? t("copyFailedMessage") : t("copyStatement")}
        </button>

        <Popover>
          <PopoverTrigger disabled={!hasAuthors} className={EXPORT_BUTTON}>
            <Download className="size-4" aria-hidden="true" />
            {toolchain ? t("toolchainOtherFormats") : t("exportData")}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent align="start" aria-label={t("exportData")} className="w-72 max-w-[calc(100vw-2rem)] p-2">
            <ul aria-label={t("a11yExportFormat")} className="grid">
              {(Object.keys(DATA_FORMATS) as DataFormat[])
                .filter((value) => !["xml", "crossref", "tenzing"].includes(value) && value !== toolchainOutput)
                .map(exportRow)}
            </ul>
            <div className="mt-2 border-t border-outline-variant/40 pt-2">
              <p className="mb-1 text-xs font-semibold text-on-surface-variant">{t("toolchainJournal")}</p>
              <ul className="grid">{(["xml", "crossref", "tenzing"] as const).map(exportRow)}</ul>
            </div>
          </PopoverContent>
        </Popover>
        {/* On a phone the figure leaves from here, with the other outputs: the grid above is a list
            of roles there, with no figure on screen. */}
        {hasAuthors && (
          <div className="md:hidden">
            <HeatmapExports authors={authors} showLevels={!yesNo} triggerClassName={EXPORT_BUTTON} />
          </div>
        )}
      </div>
      {toolchain && (
        <ToolchainPanel compact toolchain={toolchain} language={outputLanguage} settings={heatmapSettings}>
          {toolchainOutput ? (
            <OutputBlock authors={authors} format={toolchainOutput} options={exportOptions} language={outputLanguage}>
              {toolchainOutput === "json" && answersChoice}
            </OutputBlock>
          ) : (
            <button
              type="button"
              disabled={!statement}
              onClick={() =>
                download(new Blob([statement], { type: "text/plain;charset=utf-8" }), "credit-statement.txt")
              }
              className={`${EXPORT_ITEM_BUTTON} justify-self-start`}
            >
              <Download className="size-3.5" aria-hidden="true" />
              {t("downloadFormat", { format: "TXT" })}
            </button>
          )}
        </ToolchainPanel>
      )}
      <div className="border-t border-outline-variant/40 pt-3">
        <CreditBadge className="flex min-h-6 items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-primary transition-colors" />
      </div>
    </div>
  );
}
