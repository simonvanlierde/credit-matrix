"use client";

import { useTranslations } from "use-intl";
import { ExternalLink } from "@/components/ui/external-link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CREDIT_ROLES } from "@/core";
import type { RoleDescriber, RoleTranslator } from "@/core/i18n";

/**
 * A role's name as a button that opens its short description, with a link to
 * the full NISO definition. The name is the trigger, so the matrix spends no
 * tab stop or column on a separate info button.
 */
export function RoleInfo({
  role,
  translateRole,
  describeRole,
  language,
  className,
  triggerProps,
}: {
  role: (typeof CREDIT_ROLES)[number];
  translateRole: RoleTranslator;
  describeRole: RoleDescriber;
  language: string;
  className?: string;
  triggerProps?: React.ComponentProps<"button"> & { "data-role-head"?: number };
}) {
  const t = useTranslations();
  const name = translateRole(role.name);
  // The description follows the interface language: it is help, never exported.
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={name}
          {...triggerProps}
          className={`block min-h-6 rounded text-left font-medium text-on-surface underline decoration-outline decoration-dotted underline-offset-4 transition-colors hover:text-primary hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:text-primary ${className ?? ""}`}
        >
          {name}
        </button>
      </PopoverTrigger>
      <PopoverContent lang={language} className="max-w-xs text-xs leading-relaxed text-on-surface-variant">
        <strong className="text-on-surface">{name}.</strong> {describeRole(role.name)}{" "}
        <ExternalLink href={role.url} className="gap-0.5 text-primary hover:underline whitespace-nowrap">
          {t("fullDefinition")}
        </ExternalLink>
      </PopoverContent>
    </Popover>
  );
}
