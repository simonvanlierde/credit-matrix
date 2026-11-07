"use client";

import { Info } from "lucide-react";
import { AboutPanel } from "@/components/AboutPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslations } from "@/lib/translations";

/** The labelled About link in the header nav. */
export function AboutPopover({ version }: { version: string }) {
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
        className="w-[22rem] max-w-[calc(100vw-1.5rem)] space-y-3 text-sm text-on-surface-variant"
      >
        <AboutPanel version={version} />
      </PopoverContent>
    </Popover>
  );
}
