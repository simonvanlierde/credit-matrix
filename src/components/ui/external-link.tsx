"use client";

import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { cn } from "@/lib/utils";

/** A link that opens in a new tab, with the glyph and the screen-reader note saying so. */
export function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const t = useTranslations();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center", className)}>
      {children}
      <ExternalLinkIcon className="size-3" aria-hidden="true" />
      <span className="sr-only">{t("opensInNewTab")}</span>
    </a>
  );
}
