import { FileText } from "lucide-react";
import { usePathname } from "@/lib/pathname";
import { useTranslations } from "@/lib/translations";

/** The Docs page link in the desktop header nav. */
export function DocsLink() {
  const t = useTranslations();
  const active = usePathname().startsWith("/docs");
  return (
    <a
      href="/docs"
      aria-current={active ? "page" : undefined}
      className="touch-target inline-flex items-center justify-center whitespace-nowrap gap-1 text-sm text-on-surface-variant transition-colors hover:text-primary aria-[current=page]:font-semibold aria-[current=page]:text-primary"
    >
      <FileText className="size-3.5" aria-hidden="true" />
      <span>{t("docsTitle")}</span>
    </a>
  );
}
