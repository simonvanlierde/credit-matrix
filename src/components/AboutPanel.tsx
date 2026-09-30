"use client";

import { Code, ExternalLink } from "lucide-react";
import { useTranslations } from "use-intl";
import { PRODUCT_NAME } from "@/components/BrandMark";
import { IN_TEXT_LINK, LicenseLink } from "@/components/ui/license-link";

/**
 * What the app is, who made it, and what it is built on. Lives apart from its
 * trigger because three surfaces open it: the desktop nav link, the mobile
 * brand menu, and the welcome modal. One body, so they can never disagree.
 *
 * `version` is read from package.json by the (server) layout and page, so the
 * manifest never reaches the client bundle.
 */
export function AboutPanel({ version }: { version: string }) {
  const t = useTranslations();
  return (
    <>
      <div>
        <p className="font-semibold text-on-surface">
          {PRODUCT_NAME} <span className="font-mono text-xs font-normal text-on-surface-variant">v{version}</span>
        </p>
        <p className="mt-0.5">{t("aboutTagline")}</p>
      </div>
      <a
        href="https://github.com/simonvanlierde/credit-matrix"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
      >
        <Code className="size-4" aria-hidden="true" />
        {t("sourceOnGitHub")}
        <ExternalLink className="size-3" aria-hidden="true" />
        <span className="sr-only">{t("opensInNewTab")}</span>
      </a>
      {/* Authorship and license sit with the identity, not in the small print:
          they say who made this, which is the same kind of fact as what it is.
          The acknowledgements below are footnotes to it. Names and license from
          LICENSE and CITATION.cff. */}
      <p className="text-xs text-on-surface-variant">
        © 2026{" "}
        <a href="https://github.com/simonvanlierde" target="_blank" rel="noopener noreferrer" className={IN_TEXT_LINK}>
          Simon van Lierde
        </a>
        <span aria-hidden="true"> · </span>
        <a
          href="https://github.com/simonvanlierde/credit-matrix/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer license"
          className={IN_TEXT_LINK}
        >
          MIT License
        </a>
      </p>
      {/* `text-pretty`: these sentences end on an inline-flex link, which is one
          atomic box, so without it the trailing period drops onto its own line. */}
      <div className="space-y-1.5 border-t border-outline-variant/30 pt-3 text-xs text-pretty">
        <p className="font-bold uppercase tracking-widest text-on-surface-variant">{t("acknowledgements")}</p>
        <p>
          {t("aboutInspiredBy")}{" "}
          <a
            href="https://github.com/IPHYS-Bioinformatics/CRediT-Generator"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            Python/Dash CRediT Generator
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only">{t("opensInNewTab")}</span>
          </a>
          .
        </p>
        <p>
          {t("aboutOutputTranslations")}{" "}
          <a
            href="https://github.com/contributorshipcollaboration/credit-translation"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            credit-translation contributors
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only">{t("opensInNewTab")}</span>
          </a>{" "}
          (<LicenseLink>CC BY 4.0</LicenseLink>).
        </p>
        <p>{t.rich("aboutTaxonomy", { cc: (chunks) => <LicenseLink>{chunks}</LicenseLink> })}</p>
        <p>{t("aboutPrivacy")}</p>
      </div>
    </>
  );
}
