import type { ReactNode } from "react";
import { useTranslations } from "@/lib/translations";
import type { MessageKey } from "@/locales/keys";

/**
 * A landmark `<section>` whose accessible name is translated.
 *
 * The label is the only thing here that needs a hook, and `page.tsx` is a
 * server component. Wrapping just the label keeps the page on the server: the
 * three children are client components already, so this adds no bundle weight
 * that was not there — and it stops the page's landmarks being the one part of
 * the interface stuck in English for a screen-reader user.
 */
export function LabelledSection({
  labelKey,
  id,
  className,
  children,
}: {
  labelKey: MessageKey;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations();
  return (
    <section id={id} aria-label={t(labelKey)} className={className}>
      {children}
    </section>
  );
}
