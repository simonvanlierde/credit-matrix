import { ArrowDown, ArrowUp, AtSign, Check, ListChecks, Pencil, Plus, Send, UserRound, Users, X } from "lucide-react";
import { type MouseEventHandler, type ReactElement, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger, useTextAnchor } from "@/components/ui/popover";
import { announce } from "@/lib/announce";
import { copyAskLink } from "@/lib/ask-message";
import { useTranslations } from "@/lib/translations";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useCopyStatus } from "@/lib/use-copy-status";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useContributionStore } from "@/store/contribution-store";
import { LevelChoice, useRunBulk } from "./BulkAssignMenu";
import { MENU_ICON, MenuItem } from "./menu-item";

/**
 * The one menu for a person, whichever surface it opens from: the list row's
 * "…" button, the grid's name header, or the name in the statement. `trigger`
 * is that surface's own button. Only the list row passes `onAddOrcid`, as its
 * ORCID field is local state; elsewhere the request goes to the list.
 */
export function PersonMenu({
  authorId,
  trigger,
  surface,
  align = "start",
  canAddOrcid,
  onAddOrcid,
  textAnchor: onText = false,
}: {
  authorId: string;
  trigger: ReactElement;
  /** The trigger is running text (the statement): a click opens the menu, but it stays text. */
  textAnchor?: boolean;
  /** `rail` is the collapsed list: its initials chips open this menu. */
  surface: "list" | "rail" | "grid" | "statement";
  align?: "start" | "center" | "end";
  /** List only: false while the ORCID field is already open. */
  canAddOrcid?: boolean;
  onAddOrcid?: () => void;
}) {
  const t = useTranslations();
  const { translateInterfaceUi: translateUi } = useCreditTranslators();
  const { locked, editableAuthorId } = useClaimLock();
  const author = useContributionStore((s) => s.authors.find((a) => a.id === authorId));
  const index = useContributionStore((s) => s.authors.findIndex((a) => a.id === authorId));
  const rowCount = useContributionStore((s) => s.authors.length);
  const isSelf = useContributionStore((s) => s.selfId === authorId);
  const graded = useContributionStore((s) => s.inputMode === "levels");
  const setSelfId = useContributionStore((s) => s.setSelfId);
  const setAuthorMarker = useContributionStore((s) => s.setAuthorMarker);
  const moveAuthor = useContributionStore((s) => s.moveAuthor);
  const setAllAuthorScores = useContributionStore((s) => s.setAllAuthorScores);
  const setListFocus = useContributionStore((s) => s.setListFocus);
  const runBulk = useRunBulk();
  const [open, setOpen] = useState(false);
  const [choosingLevel, setChoosingLevel] = useState(false);
  // Set when the menu hands focus to a field in the list: the trigger refocus would blur it
  // (and the ORCID field's blur handler dismisses it).
  const skipRefocus = useRef(false);
  const [askStatus, copyAsk] = useCopyStatus({
    copied: t("askContributorCopied", { name: author?.name ?? "" }),
  });
  const [askKind, setAskKind] = useState<"blank" | "prefilled">("blank");
  const askCopied = askStatus === "copied" ? askKind : null;
  const textAnchor = useTextAnchor(open, () => openChange(true));

  if (!author) return trigger;
  const name = author.name;
  const frozen = locked && authorId !== editableAuthorId;
  const label = t("contributorActions", { name });

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) setChoosingLevel(false);
  }
  function toList(orcid: boolean) {
    skipRefocus.current = true;
    if (orcid && onAddOrcid) onAddOrcid();
    else setListFocus({ authorId, orcid });
    openChange(false);
  }
  function move(by: -1 | 1) {
    moveAuthor(index, index + by);
    announce(t("annMoved", { name, position: index + by + 1, total: rowCount }));
  }
  async function ask(blank: boolean) {
    if (!author) return;
    setAskKind(blank ? "blank" : "prefilled");
    // Only a link that actually reached the clipboard counts as an ask.
    await copyAskLink(author, t, blank, (link) => copyAsk(link));
  }
  function assign(score: number) {
    runBulk(() => setAllAuthorScores(authorId, score));
    openChange(false);
  }

  const showOrcid = surface === "list" ? (canAddOrcid ?? false) : !(author.orcid ?? "").length;
  const canMoveUp = !locked && index > 0;
  const canMoveDown = !locked && index < rowCount - 1;

  return (
    <Popover open={open} onOpenChange={openChange}>
      {onText ? (
        textAnchor.anchorOn(trigger as ReactElement<{ onClick?: MouseEventHandler }>)
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        align={align}
        aria-label={label}
        onInteractOutside={textAnchor.contentProps.onInteractOutside}
        onCloseAutoFocus={(event) => {
          if (!skipRefocus.current) return textAnchor.contentProps.onCloseAutoFocus(event);
          skipRefocus.current = false;
          event.preventDefault();
        }}
        collisionPadding={8}
        // The menu is taller than a short phone screen: it scrolls inside what is left.
        className="max-h-[var(--radix-popover-content-available-height)] w-60 overflow-y-auto p-1"
      >
        {choosingLevel ? (
          <LevelChoice onPick={assign} translateUi={translateUi} />
        ) : (
          <>
            {/* Author order is credit, and dragging is not something every pointer
                can do (WCAG 2.5.7). The menu stays open, so a person can move
                several places in a row. */}
            <div className="mb-1 border-b border-outline-variant/40 pb-1">
              <MenuItem icon={<ArrowUp className={MENU_ICON} />} disabled={!canMoveUp} onClick={() => move(-1)}>
                {t("moveUp")}
              </MenuItem>
              <MenuItem icon={<ArrowDown className={MENU_ICON} />} disabled={!canMoveDown} onClick={() => move(1)}>
                {t("moveDown")}
              </MenuItem>
            </div>
            {!locked && (
              <MenuItem icon={<UserRound className={MENU_ICON} />} onClick={() => setSelfId(isSelf ? null : authorId)}>
                {isSelf ? t("thisIsNotMe") : t("thisIsMe")}
              </MenuItem>
            )}
            <MenuItem
              icon={<Users className={MENU_ICON} />}
              disabled={frozen}
              onClick={() => setAuthorMarker(authorId, "equalContribution", !author.equalContribution)}
            >
              {author.equalContribution ? t("equalContributionUnset") : t("equalContributionSet")}
            </MenuItem>
            <MenuItem
              icon={<AtSign className={MENU_ICON} />}
              disabled={frozen}
              onClick={() => setAuthorMarker(authorId, "corresponding", !author.corresponding)}
            >
              {author.corresponding ? t("correspondingUnset") : t("correspondingSet")}
            </MenuItem>
            <div className="my-1 border-y border-outline-variant/40 py-1">
              <MenuItem
                icon={<ListChecks className={MENU_ICON} />}
                disabled={locked}
                onClick={() => (graded ? setChoosingLevel(true) : assign(100))}
              >
                {graded ? t("setAllRoles") : t("bulkAssignAll")}
              </MenuItem>
              <MenuItem icon={<X className={MENU_ICON} />} disabled={locked} onClick={() => assign(0)}>
                {t("bulkClearAll")}
              </MenuItem>
            </div>
            {!(locked || isSelf) && (
              <div className="mb-1 border-b border-outline-variant/40 pb-1">
                {(["blank", "prefilled"] as const).map((kind) => (
                  <MenuItem
                    key={kind}
                    icon={
                      askCopied === kind ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : (
                        <Send className={MENU_ICON} />
                      )
                    }
                    onClick={() => void ask(kind === "blank")}
                  >
                    {askCopied === kind
                      ? t("askCopied")
                      : kind === "blank"
                        ? t("askBlank", { name })
                        : t("askPrefilled", { name })}
                  </MenuItem>
                ))}
                <p className="px-2 pt-0.5 pb-1 text-[11px] leading-snug text-on-surface-variant">{t("askLinkHint")}</p>
              </div>
            )}
            {showOrcid && (
              <MenuItem icon={<Plus className={MENU_ICON} />} disabled={frozen} onClick={() => toList(true)}>
                {t("addOrcid")}
              </MenuItem>
            )}
            {surface !== "list" && (
              <MenuItem icon={<Pencil className={MENU_ICON} />} disabled={frozen} onClick={() => toList(false)}>
                {t("editInList")}
              </MenuItem>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
