"use client";

import { useTranslations } from "use-intl";

/**
 * The CC BY 4.0 deed. Attribution under that license asks for a link to the
 * license itself wherever it is practicable, and on a web page it is: the app
 * redistributes both the role translations and NISO's badge image, so the
 * notice has to travel with the deployed app, not only with the repository.
 */
const CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/";

/**
 * A link that sits inside a sentence. Underlined rather than only recolored:
 * ink blue against muted paper does not clear 3:1 on its own, so color alone
 * would be the only thing separating it from the prose around it. Links that
 * are their own line carry an external-link glyph instead and stay quiet until
 * hover.
 */
export const IN_TEXT_LINK = "text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary";

export function LicenseLink({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  return (
    <a href={CC_BY_4} target="_blank" rel="noopener noreferrer license" className={IN_TEXT_LINK}>
      {children}
      <span className="sr-only"> {t("opensInNewTab")}</span>
    </a>
  );
}
