"use client";

import { Info } from "lucide-react";
import { useTranslations } from "use-intl";
import { AboutPanel } from "@/components/AboutPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The labelled About link. `container` targets the portal at an open modal
 * dialog: the top layer makes the rest of the document inert, so a panel
 * portalled to <body> from inside a dialog would render unclickable.
 */
export function AboutPopover({ version, container }: { version: string; container?: HTMLElement | null }) {
  const t = useTranslations();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary transition-colors"
          aria-label={t("aboutApp")}
        >
          <Info className="size-3.5" aria-hidden="true" />
          {t("about")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={t("aboutApp")}
        container={container}
        className="w-[22rem] max-w-[calc(100vw-1.5rem)] space-y-3 text-sm text-on-surface-variant"
      >
        <AboutPanel version={version} />
      </PopoverContent>
    </Popover>
  );
}
