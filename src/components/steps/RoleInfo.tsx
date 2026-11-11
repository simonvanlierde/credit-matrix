import { ListChecks, X } from "lucide-react";
import { type ReactElement, useState } from "react";
import { ExternalLink } from "@/components/ui/external-link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CREDIT_ROLES } from "@/core";
import type { RoleDescriber, RoleTranslator } from "@/core/i18n";
import { useTranslations } from "@/lib/translations";
import { useClaimLock } from "@/lib/use-claim-lock";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import { useContributionStore } from "@/store/contribution-store";
import { LevelChoice, useRunBulk } from "./BulkAssignMenu";

const ACTION =
  "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-disabled:cursor-not-allowed aria-disabled:text-on-surface-variant/50 aria-disabled:hover:bg-transparent";

/**
 * A role's name as a button that opens its short description, with a link to
 * the full NISO definition, and the two things you do to a whole role: assign
 * it to everyone and clear it for everyone. The name is the trigger, so the
 * matrix spends no tab stop or column on a separate info button. `trigger`
 * replaces the default button where the name sits in running text.
 */
export function RoleInfo({
  role,
  translateRole,
  describeRole,
  language,
  className,
  triggerProps,
  trigger,
}: {
  role: (typeof CREDIT_ROLES)[number];
  translateRole: RoleTranslator;
  describeRole: RoleDescriber;
  language: string;
  className?: string;
  triggerProps?: React.ComponentProps<"button"> & { "data-role-head"?: number };
  trigger?: ReactElement;
}) {
  const t = useTranslations();
  const { translateInterfaceUi: translateUi } = useCreditTranslators();
  const { locked } = useClaimLock();
  const graded = useContributionStore((s) => s.inputMode === "levels");
  const setRoleScores = useContributionStore((s) => s.setRoleScores);
  const runBulk = useRunBulk();
  const [open, setOpen] = useState(false);
  const [choosingLevel, setChoosingLevel] = useState(false);
  const name = translateRole(role.name);
  const roleIndex = CREDIT_ROLES.findIndex((candidate) => candidate.name === role.name);

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) setChoosingLevel(false);
  }
  function assign(score: number) {
    runBulk(() => setRoleScores(roleIndex, score));
    openChange(false);
  }

  // The description follows the interface language: it is help, never exported.
  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            title={name}
            {...triggerProps}
            className={`block min-h-6 rounded text-left font-medium text-on-surface underline decoration-outline decoration-dotted underline-offset-4 transition-colors hover:text-primary hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:text-primary ${className ?? ""}`}
          >
            {name}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent aria-label={name} className="w-64 max-w-xs p-1">
        {choosingLevel ? (
          <LevelChoice onPick={assign} translateUi={translateUi} />
        ) : (
          <>
            <p lang={language} className="px-2 pt-1.5 pb-2 text-xs leading-relaxed text-on-surface-variant">
              <strong className="text-on-surface">{name}.</strong> {describeRole(role.name)}{" "}
              <ExternalLink href={role.url} className="gap-0.5 text-primary hover:underline whitespace-nowrap">
                {t("fullDefinition")}
              </ExternalLink>
            </p>
            <div className="border-t border-outline-variant/40 pt-1">
              <button
                type="button"
                aria-disabled={locked || undefined}
                onClick={locked ? undefined : () => (graded ? setChoosingLevel(true) : assign(100))}
                className={ACTION}
              >
                <ListChecks className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
                {graded ? t("assignToEveryone") : t("bulkAssignToAll")}
              </button>
              <button
                type="button"
                aria-disabled={locked || undefined}
                onClick={locked ? undefined : () => assign(0)}
                className={ACTION}
              >
                <X className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
                {t("bulkClearRole")}
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
