"use client";

import { useTranslations } from "use-intl";
import { LicenseLink } from "@/components/ui/license-link";

const REPO = "https://github.com/simonvanlierde/credit-matrix";
// The concept DOI from CITATION.cff: it resolves to every version, so it never changes on release.
const CONCEPT_DOI = "https://doi.org/10.5281/zenodo.21213659";
const INTEGRATIONS = `${REPO}/tree/main/integrations`;

// Each tool with the line that puts the statement in a document, so a reader can tell at a glance
// whether it fits their setup. The line is code, so it stays untranslated.
const PLUGINS = [
  { name: "MyST, Jupyter Book", href: `${INTEGRATIONS}/myst#readme`, code: ":::{credit-statement}" },
  { name: "Quarto", href: `${INTEGRATIONS}/quarto#readme`, code: "filters: [credit-matrix]" },
  { name: "Pandoc", href: `${INTEGRATIONS}/pandoc#readme`, code: "--lua-filter=credit-matrix.lua" },
  { name: "Typst", href: `${INTEGRATIONS}/typst#readme`, code: "#credit-statement(team)" },
  { name: "Sphinx", href: `${INTEGRATIONS}/sphinx#readme`, code: ".. credit-statement::" },
];

/** What the app is, how to cite it, whom it thanks, and what it sends where. */
export function AboutPage({ version }: { version: string }) {
  const t = useTranslations();
  return (
    <article className="document">
      <h2>{t("aboutPageTitle")}</h2>
      <p className="font-headline text-xl leading-snug text-on-surface sm:text-2xl">{t("aboutTagline")}</p>
      {/* A colophon: the facts a citation or a licence check needs, in one place. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-t border-outline-variant pt-4 text-sm">
        <dt>{t("aboutVersion")}</dt>
        <dd className="font-mono text-on-surface">v{version}</dd>
        <dt>{t("aboutLicense")}</dt>
        <dd>
          <a href={`${REPO}/blob/main/LICENSE`} rel="license">
            MIT License
          </a>
        </dd>
        <dt>{t("aboutSource")}</dt>
        <dd>
          <a href={REPO}>github.com/simonvanlierde/credit-matrix</a>
        </dd>
        <dt>{t("aboutAuthor")}</dt>
        <dd className="text-on-surface">
          © 2026 <a href="https://simonvanlierde.com">Simon van Lierde</a>
        </dd>
      </dl>

      <h3>{t("aboutCiteTitle")}</h3>
      <p>
        {t("aboutCite")} <a href={CONCEPT_DOI}>{CONCEPT_DOI}</a>
      </p>
      <p>
        {t.rich("aboutCiteMetadata", {
          link: (chunks) => <a href={`${REPO}/blob/main/CITATION.cff`}>{chunks}</a>,
        })}
      </p>

      <h3 id="plugins">{t("aboutPluginsTitle")}</h3>
      <p>{t("aboutPlugins")}</p>
      {/* Laid out like the colophon: the tool, then what you type to use it. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        {PLUGINS.map(({ name, href, code }) => (
          <div key={name} className="contents">
            <dt>
              <a href={href}>{name}</a>
            </dt>
            <dd className="min-w-0 break-words">
              <code>{code}</code>
            </dd>
          </div>
        ))}
      </dl>
      <p>
        {t.rich("aboutPluginsSoftware", {
          cli: (chunks) => <a href={`${REPO}/tree/main/src/core#cli`}>{chunks}</a>,
          citesync: (chunks) => <a href="https://simonvanlierde.com/citesync/">{chunks}</a>,
          drift: (chunks) => <a href="https://github.com/simonvanlierde/codemeta-drift">{chunks}</a>,
        })}
      </p>

      <h3>{t("acknowledgements")}</h3>
      <p>
        {t("aboutInspiredBy")}{" "}
        <a href="https://github.com/IPHYS-Bioinformatics/CRediT-Generator">Python/Dash CRediT Generator</a>.
      </p>
      <p>
        {t("aboutOutputTranslations")}{" "}
        <a href="https://github.com/contributorshipcollaboration/credit-translation">credit-translation contributors</a>{" "}
        (<LicenseLink>CC BY 4.0</LicenseLink>).
      </p>
      <p>{t.rich("aboutTaxonomy", { cc: (chunks) => <LicenseLink>{chunks}</LicenseLink> })}</p>

      <h3 id="privacy">{t("privacy")}</h3>
      <p>{t("aboutPrivacy")}</p>

      <h3>{t("accessibility")}</h3>
      <p>
        {t.rich("aboutAccessibility", {
          link: (chunks) => (
            <a href="/accessibility" hrefLang="en">
              {chunks}
            </a>
          ),
        })}
      </p>
    </article>
  );
}
