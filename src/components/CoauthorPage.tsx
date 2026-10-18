"use client";

import { BadgeCheck, Check, ChevronDown, CircleCheck, Send } from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { BrandMark, PRODUCT_NAME } from "@/components/BrandMark";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Switch } from "@/components/ui/switch";
import { type Author, CREDIT_ROLES, isValidOrcid, type OrcidProof, type SharePayloadInput } from "@/core";
import { LEVEL_SCORE } from "@/core/author";
import { DEFAULT_MONO_COLOR, heatCellColor, onColor } from "@/core/contributor-color";
import { toSharePayload } from "@/core/share-payload";
import { announce } from "@/lib/announce";
import { startOrcidSignIn, takeOrcidReturn } from "@/lib/orcid-sign-in";
import { moveRadioSelection } from "@/lib/roving-radio";
import { buildShareUrl, shareFailureKey } from "@/lib/share";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { cn } from "@/lib/utils";
import { useContributionStore } from "@/store/contribution-store";

/** The grid's level scores: Levels mode stores these, yes/no mode stores 0 or 100. */
const LEVELS = [
  { key: "none", score: LEVEL_SCORE.none, dots: 0 },
  { key: "supporting", score: LEVEL_SCORE.supporting, dots: 1 },
  { key: "equal", score: LEVEL_SCORE.equal, dots: 2 },
  { key: "lead", score: LEVEL_SCORE.lead, dots: 3 },
] as const;
const YES_NO = [
  { key: "none", score: 0, dots: 0 },
  { key: "contributed", score: 100, dots: -1 },
] as const;
type Option = (typeof LEVELS)[number] | (typeof YES_NO)[number];

/** The option a stored score falls in: the nearest one, so a 50 from an import reads as Equal. */
function optionFor(options: readonly Option[], score: number): Option {
  return options.reduce((best, option) =>
    Math.abs(option.score - score) < Math.abs(best.score - score) ? option : best,
  );
}

/**
 * The workspace's main area while a claim (ask) link is open: the workspace
 * itself, or the single-purpose page that answers the ask in its place.
 */
export function ClaimGate({ children }: { children: ReactNode }) {
  // Keyed on the ask, so a newer request (or its Undo) opens on the form, never on "Sent".
  const askKey = useContributionStore((s) =>
    s.claim && s.authors.some((author) => author.id === s.claim?.contributorId)
      ? `${s.claim.sourceDraftId}:${s.claim.contributorId}:${s.claim.sentAt ?? ""}`
      : null,
  );
  return askKey ? <CoauthorPage key={askKey} /> : children;
}

/**
 * One person answering one ask, usually on a phone, having never seen the app.
 * Their row, two markers, their details, and a way to send the answer back.
 * The lock stays in the store; this page only offers what it allows.
 */
function CoauthorPage() {
  const t = useTranslations();
  const claim = useContributionStore((s) => s.claim);
  const authors = useContributionStore((s) => s.authors);
  const title = useContributionStore((s) => s.title);
  const inputMode = useContributionStore((s) => s.inputMode);
  const activeDraftId = useContributionStore((s) => s.activeDraftId);
  const setAuthorScore = useContributionStore((s) => s.setAuthorScore);
  const setAuthorMarker = useContributionStore((s) => s.setAuthorMarker);
  const clearClaimFor = useContributionStore((s) => s.clearClaimFor);
  const { translateInterfaceRole, describeRole, translateInterfaceUi } = useCreditTranslators();
  const dark = useTheme().resolvedTheme === "dark";
  const [sent, setSent] = useState<"shared" | "copied" | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [copyStatus, copy] = useCopyStatus({ copied: t("annLinkCopied") });
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The link's `w`: when this answer was first sent, so sharing then copying the same answer
  // gives the same link, and the lead's decisions on it hold.
  const answeredAt = useRef<{ answer: string; at: number } | null>(null);
  // Back from ORCID: the sign-in and the send time of the answer it signed; "failed" when cancelled or not valid.
  const [signIn, setSignIn] = useState<{ proof: OrcidProof; sentAt: number } | "failed" | null>(null);
  const tookReturn = useRef(false);
  const firstAuthorId = useId();
  const correspondingId = useId();

  const author = authors.find((candidate) => candidate.id === claim?.contributorId);

  // The page replaces the workspace and later swaps its own view, so focus
  // starts at the heading that says where you are.
  const view = sent ?? "form";
  useEffect(() => {
    if (view) headingRef.current?.focus();
  }, [view]);

  // A ref, so StrictMode's second run does not read the address bar after the first cleared it.
  useEffect(() => {
    if (tookReturn.current) return;
    tookReturn.current = true;
    void takeOrcidReturn().then((result) => {
      if (result) setSignIn(result.proof ? result : "failed");
    });
  }, []);

  if (!claim || !author) return null;

  const reply = { authors, title, claimId: claim.contributorId, sourceDraftId: claim.sourceDraftId, reply: true };
  // The sign-in holds while the answer is still the one ORCID signed; any change needs a new one.
  const signedIn =
    signIn && signIn !== "failed" && toSharePayload({ ...reply, sentAt: signIn.sentAt }) === signIn.proof.payload
      ? signIn
      : null;

  const options = inputMode === "toggle" ? YES_NO : LEVELS;
  const marked = author.contributions.filter((c) => c.score > 0).length;
  const workTitle = title.trim();

  function replyInput(): SharePayloadInput & { sentAt: number } {
    if (signedIn) return { ...reply, sentAt: signedIn.sentAt, idToken: signedIn.proof.token };
    const answer = JSON.stringify([authors, title]);
    if (answeredAt.current?.answer !== answer) answeredAt.current = { answer, at: Date.now() };
    return { ...reply, sentAt: answeredAt.current.at };
  }

  async function buildReply(): Promise<string | null> {
    try {
      return await buildShareUrl(replyInput());
    } catch {
      announce(t(shareFailureKey()), { assertive: true });
      return null;
    }
  }

  async function handleCopy(): Promise<boolean> {
    const url = await buildReply();
    return url !== null && (await copy(url));
  }

  async function handleSend() {
    setCancelled(false);
    const url = await buildReply();
    if (url === null) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, title: t("coauthorShareTitle", { name: author?.name ?? "" }) });
        setSent("shared");
        return;
      } catch (error) {
        // Closing the share sheet is a choice, not a failure: stay, and offer the copy.
        if (error instanceof DOMException && error.name === "AbortError") {
          setCancelled(true);
          return;
        }
      }
    }
    if (await copy(url)) setSent("copied");
  }

  async function handleSignIn() {
    if (!(await startOrcidSignIn(replyInput()))) setSignIn("failed");
  }

  function handleUnlock() {
    clearClaimFor(activeDraftId);
    announce(t("annClaimUnlocked"));
  }

  const copyLabel = copyStatus === "copied" ? t("linkCopied") : t("coauthorCopyInstead");

  if (sent) {
    return (
      <div
        data-coauthor-page
        className="mx-auto flex min-h-dvh w-full max-w-[40rem] flex-col justify-center gap-4 px-4 py-10 sm:px-6"
      >
        <CircleCheck className="size-10 text-primary" aria-hidden="true" />
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-headline text-[1.75rem] leading-tight font-semibold text-balance outline-none"
        >
          {sent === "shared" ? t("coauthorSentTitle") : t("coauthorCopiedTitle")}
        </h1>
        <p className="max-w-[60ch] leading-relaxed text-on-surface-variant">{t("coauthorSentBody")}</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <button
            type="button"
            onClick={() => setSent(null)}
            className="min-h-11 rounded-lg border border-outline bg-surface-bright px-4 font-medium text-on-surface transition-colors hover:border-primary hover:text-primary"
          >
            {t("coauthorChange")}
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="min-h-11 font-medium text-primary underline underline-offset-4 hover:no-underline"
          >
            {copyLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-coauthor-page className="mx-auto w-full max-w-[40rem]">
      <div className="flex flex-col gap-3 px-4 pt-5 sm:px-6 sm:pt-8">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs text-on-surface-variant">
            <BrandMark className="size-[1.15rem] shrink-0" />
            {PRODUCT_NAME}
          </span>
          <LanguageSelector />
        </div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-headline text-[1.625rem] leading-tight font-semibold text-balance outline-none sm:text-[2rem]"
        >
          {workTitle
            ? t.rich("coauthorHeading", {
                title: workTitle,
                work: (chunks) => <em className="font-medium">{chunks}</em>,
              })
            : t("coauthorHeadingUntitled")}
        </h1>
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t.rich("coauthorAnsweringAs", {
            name: author.name,
            b: (chunks) => <strong className="font-semibold text-on-surface">{chunks}</strong>,
          })}
        </p>
        {claim.blank ? (
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {inputMode === "toggle"
              ? t("coauthorBlankHintYesNo", {
                  contributed: translateInterfaceUi("contributed"),
                  none: translateInterfaceUi("none"),
                })
              : t("coauthorBlankHint", { none: translateInterfaceUi("none") })}
          </p>
        ) : (
          <p className="rounded-lg bg-primary/10 px-3 py-2.5 text-sm leading-relaxed text-on-surface">
            {t("coauthorPrefilled")}
          </p>
        )}
      </div>

      <ol aria-label={t("coauthorRoles")} className="mt-2 px-4 sm:px-6">
        {CREDIT_ROLES.map((role, roleIndex) => {
          const score = author.contributions[roleIndex]?.score ?? 0;
          const nameId = `coauthor-role-${roleIndex}`;
          return (
            <li key={role.name} className="flex flex-col gap-2 border-b border-outline-variant py-3.5">
              <div>
                <p id={nameId} className="font-semibold">
                  {translateInterfaceRole(role.name)}
                </p>
                <p id={`${nameId}-desc`} className="text-[0.8125rem] leading-snug text-on-surface-variant">
                  {describeRole(role.name)}
                </p>
              </div>
              <LevelGroup
                labelledBy={nameId}
                describedBy={`${nameId}-desc`}
                options={options}
                value={optionFor(options, score)}
                label={(option) => translateInterfaceUi(option.key)}
                fill={(option) => heatCellColor(DEFAULT_MONO_COLOR, option.score, dark)}
                onChange={(option) => setAuthorScore(author.id, roleIndex, option.score)}
              />
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col px-4 pt-3 sm:px-6">
        <MarkerSwitch
          id={firstAuthorId}
          label={t("coauthorFirstAuthor")}
          checked={author.equalContribution}
          onChange={(value) => setAuthorMarker(author.id, "equalContribution", value)}
        />
        <MarkerSwitch
          id={correspondingId}
          label={t("coauthorCorresponding")}
          checked={author.corresponding}
          onChange={(value) => setAuthorMarker(author.id, "corresponding", value)}
        />
        <YourDetails author={author} />
        <OrcidSignIn
          signedIn={signedIn?.proof ?? null}
          failed={signIn === "failed"}
          changed={signIn !== null && !signedIn}
          onSignIn={() => void handleSignIn()}
        />
        <p className="mt-6 mb-4 text-xs text-on-surface-variant">
          <button
            type="button"
            onClick={handleUnlock}
            className="min-h-11 underline underline-offset-4 hover:text-primary"
          >
            {t("claimUnlock")}
          </button>
        </p>
      </div>

      <div className="sticky bottom-0 border-t border-outline-variant bg-surface px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        <button
          type="button"
          onClick={() => void handleSend()}
          className="flex h-13 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-on-primary transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Send className="size-4" aria-hidden="true" />
          {t("coauthorSend")}
        </button>
        <p className="mt-1.5 text-center text-xs text-on-surface-variant" aria-live="polite">
          {cancelled ? (
            <>
              {t("coauthorNotSent")}{" "}
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="font-medium text-primary underline underline-offset-4"
              >
                {copyLabel}
              </button>
            </>
          ) : (
            t("coauthorMarked", { count: marked, total: CREDIT_ROLES.length })
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * One role's answer: a radiogroup of full-width segments, one tab stop, arrows
 * move and select (WAI-ARIA radio group). The chosen segment takes the grid's
 * fill for that level and its dots, so the answer reads in the grid's language.
 */
function LevelGroup({
  labelledBy,
  describedBy,
  options,
  value,
  label,
  fill,
  onChange,
}: {
  labelledBy: string;
  describedBy: string;
  options: readonly Option[];
  value: Option;
  label: (option: Option) => string;
  fill: (option: Option) => string;
  onChange: (option: Option) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={(event) => moveRadioSelection(event, options, options.indexOf(value), onChange)}
      className={cn("grid gap-1", options.length === 4 ? "grid-cols-4" : "grid-cols-2")}
    >
      {options.map((option) => {
        const active = option === value;
        const background = active && option.score > 0 ? fill(option) : undefined;
        return (
          // biome-ignore lint/a11y/useSemanticElements: full-width segments, not native radios; role=radio with a roving tabindex is the pattern.
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option)}
            style={background ? { backgroundColor: background, color: onColor(background) } : undefined}
            className={cn(
              "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              active
                ? cn(
                    "font-semibold",
                    option.score === 0 && "border-2 border-on-surface bg-surface-bright text-on-surface",
                  )
                : "border border-outline bg-surface-bright font-medium text-on-surface-variant hover:border-primary hover:text-on-surface",
            )}
          >
            <LevelGlyph dots={option.dots} />
            <span className="max-w-full truncate">{label(option)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The grid's level mark: 1–3 dots, a check for yes/no, an empty slot of the same height for none. */
function LevelGlyph({ dots }: { dots: number }) {
  // A fixed-height slot, so every label sits on the same line.
  return (
    <span aria-hidden="true" className="flex h-3 items-center">
      {dots < 0 ? (
        <Check className="size-3" strokeWidth={3} />
      ) : dots > 0 ? (
        <svg aria-hidden="true" viewBox={`0 0 ${dots * 7 - 2} 5`} className="h-1.5 w-auto">
          {Array.from({ length: dots }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the dots are identical and never reorder.
            <circle key={i} cx={2.5 + i * 7} cy={2.5} r={2.5} fill="currentColor" />
          ))}
        </svg>
      ) : null}
    </span>
  );
}

function MarkerSwitch({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <label htmlFor={id} className="flex flex-1 cursor-pointer items-center self-stretch py-2">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * Optional ORCID sign-in: the answer then reaches the asker marked as
 * verified by ORCID. The sign-in travels in the reply link and nowhere else.
 */
function OrcidSignIn({
  signedIn,
  failed,
  changed,
  onSignIn,
}: {
  signedIn: OrcidProof | null;
  failed: boolean;
  changed: boolean;
  onSignIn: () => void;
}) {
  const t = useTranslations();
  if (signedIn) {
    return (
      <p
        role="status"
        className="mt-4 flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2.5 text-sm leading-relaxed text-on-surface"
      >
        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          {t("coauthorOrcidSigned", {
            who: signedIn.name ? `${signedIn.name} (${signedIn.orcid})` : signedIn.orcid,
          })}
        </span>
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-outline-variant pt-4">
      <p className="text-sm leading-relaxed text-on-surface-variant">
        {changed && !failed ? t("coauthorOrcidChanged") : t("coauthorOrcidHint")}
      </p>
      {failed && (
        <p role="alert" className="text-sm text-error">
          {t("coauthorOrcidFailed")}
        </p>
      )}
      <button
        type="button"
        onClick={onSignIn}
        className="flex min-h-11 items-center justify-center gap-2 self-start rounded-lg border border-outline bg-surface-bright px-4 font-medium text-on-surface transition-colors hover:border-primary hover:text-primary"
      >
        <BadgeCheck className="size-4" aria-hidden="true" />
        {t("coauthorOrcidSignIn")}
      </button>
    </div>
  );
}

/**
 * Name and iD correction, out of the way: the asker usually has them right, and
 * whatever is here travels back with the answer.
 */
function YourDetails({ author }: { author: Author }) {
  const t = useTranslations();
  const updateAuthorName = useContributionStore((s) => s.updateAuthorName);
  const updateAuthorOrcid = useContributionStore((s) => s.updateAuthorOrcid);
  const [name, setName] = useState(author.name);
  const [orcid, setOrcid] = useState(author.orcid ?? "");
  const [orcidInvalid, setOrcidInvalid] = useState(false);
  const nameId = useId();
  const orcidId = useId();

  useEffect(() => setName(author.name), [author.name]);

  function commitName() {
    if (name.trim() === author.name) return;
    // An empty or unusable name is refused by the store; show what stands.
    if (!updateAuthorName(author.id, name)) setName(author.name);
  }

  function commitOrcid() {
    const value = orcid.trim();
    if (value && !isValidOrcid(value)) {
      setOrcidInvalid(true);
      return;
    }
    setOrcidInvalid(false);
    updateAuthorOrcid(author.id, value);
  }

  const field =
    "min-h-11 w-full rounded-lg border border-outline bg-surface-bright px-3 text-base text-on-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

  return (
    <details className="group mt-2 border-t border-outline-variant">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-medium [&::-webkit-details-marker]:hidden">
        {t("coauthorDetails")}
        <ChevronDown
          className="size-4 text-on-surface-variant transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-3 pb-2">
        <p className="text-sm text-on-surface-variant">{t("coauthorDetailsHint")}</p>
        <label htmlFor={nameId} className="flex flex-col gap-1 text-sm font-medium">
          {t("coauthorName")}
          <input
            id={nameId}
            value={name}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => event.key === "Enter" && commitName()}
            className={field}
          />
        </label>
        <label htmlFor={orcidId} className="flex flex-col gap-1 text-sm font-medium">
          {t("a11yOrcidInput")}
          <input
            id={orcidId}
            value={orcid}
            inputMode="text"
            placeholder="0000-0000-0000-0000"
            aria-invalid={orcidInvalid}
            aria-describedby={orcidInvalid ? `${orcidId}-error` : undefined}
            onChange={(event) => setOrcid(event.target.value)}
            onBlur={commitOrcid}
            onKeyDown={(event) => event.key === "Enter" && commitOrcid()}
            className={cn(field, "font-mono", orcidInvalid && "border-error")}
          />
        </label>
        {orcidInvalid && (
          <p id={`${orcidId}-error`} className="text-sm text-error">
            {t("errOrcidINVALID_ID")}
          </p>
        )}
      </div>
    </details>
  );
}
