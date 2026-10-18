"use client";

import { ArrowLeft, ExternalLink, Info } from "lucide-react";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { BarList, LineChart, TableToggle } from "@/components/census/charts";
import { IN_TEXT_LINK } from "@/components/ui/license-link";
import { CREDIT_ROLES } from "@/core";
import { useCreditTranslators } from "@/lib/use-credit-translators";
import type censusJson from "../../../public/data/census.json";

type CensusData = typeof censusJson;

/** CRediT appeared in 2014; earlier "roles" are a handful of free-text matches. */
const FIRST_YEAR = 2010;
const STYLES = ["jats4r", "plos_uri", "statement_text", "contrib_text"] as const;
const PLACES = ["all", "first", "middle", "last"] as const;
const SOURCE = "https://github.com/simonvanlierde/credit-matrix/tree/main/census";

const STYLE_KEYS = {
  jats4r: ["censusStyleJats4r", "censusStyleJats4rNote"],
  plos_uri: ["censusStylePlosUri", "censusStylePlosUriNote"],
  statement_text: ["censusStyleStatement", "censusStyleStatementNote"],
  contrib_text: ["censusStyleContribText", "censusStyleContribTextNote"],
} as const;

const PLACE_KEYS = {
  all: "censusPlaceAll",
  first: "censusPlaceFirst",
  middle: "censusPlaceMiddle",
  last: "censusPlaceLast",
} as const;

/** The English role name for a credit.niso.org slug, which the role catalog translates. */
function roleName(slug: string): string {
  return CREDIT_ROLES.find((r) => r.url.endsWith(`/${slug}/`))?.name ?? slug;
}

function Section({ title, caption, children }: { title: string; caption: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-outline-variant pt-8">
      <h3 className="font-headline text-2xl font-semibold text-balance text-on-surface">{title}</h3>
      <p className="mt-1.5 max-w-[65ch] text-sm text-pretty text-on-surface-variant">{caption}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function CensusDashboard({ data }: { data: CensusData }) {
  const t = useTranslations();
  const format = useFormatter();
  const { translateInterfaceRole } = useCreditTranslators();
  const pct = (share: number, digits = 0) =>
    format.number(share, { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: digits });
  const count = (n: number) => format.number(n);

  const years = data.years.filter((y) => y.year >= FIRST_YEAR);
  const newest = years.at(-1)?.year;
  const focus = data.years.find((y) => y.year === data.focus_year);
  const adoption = years.map((y) => ({ x: y.year, y: y.with_roles / y.articles }));
  const perAuthor = years.flatMap((y) => (y.roles_per_author === null ? [] : [{ x: y.year, y: y.roles_per_author }]));
  const total = new Map(years.map((y) => [y.year, y.articles]));
  const styleSeries = Object.fromEntries(
    STYLES.map((style) => [
      style,
      years.map((y) => {
        const row = data.styles.find((s) => s.year === y.year && s.style === style);
        return { x: y.year, y: (row?.articles ?? 0) / (total.get(y.year) ?? 1) };
      }),
    ]),
  ) as Record<(typeof STYLES)[number], { x: number; y: number }[]>;
  const styleMax = Math.max(...Object.values(styleSeries).flatMap((s) => s.map((p) => p.y)));
  const shares = new Map(data.roles.map((r) => [`${r.role} ${r.place}`, r.share]));
  const roles = [...new Set(data.roles.map((r) => r.role))].sort(
    (a, b) => (shares.get(`${b} all`) ?? 0) - (shares.get(`${a} all`) ?? 0),
  );
  const roleMax = Math.max(...data.roles.map((r) => r.share));
  const bar = (name: string, row: { articles: number; with_roles: number }) => ({
    key: name,
    label: name,
    share: row.with_roles / row.articles,
    detail: t("censusOfArticles", { count: row.articles }),
  });
  const byShare = (a: { share: number }, b: { share: number }) => b.share - a.share;
  const fields = data.fields.map((r) => bar(r.field, r)).sort(byShare);
  const publishers = data.publishers.map((r) => bar(r.publisher, r)).sort(byShare);

  return (
    <div className="desk:h-full desk:overflow-y-auto">
      <article className="mx-auto max-w-5xl space-y-10 px-4 pt-6 pb-16 sm:px-8">
        <header className="space-y-5">
          <a href="/" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("censusBack")}
          </a>
          <h2 className="font-headline text-4xl font-semibold tracking-tight text-on-surface sm:text-5xl">
            {t("censusTitle")}
          </h2>
          {focus && (
            <p className="max-w-[34ch] font-headline text-2xl leading-snug text-balance text-on-surface sm:text-3xl">
              {t("censusHeadline", { year: focus.year, share: pct(focus.with_roles / focus.articles) })}
            </p>
          )}
          <p className="max-w-[65ch] text-on-surface-variant">{t("censusLead", { articles: count(data.articles) })}</p>
          <aside
            aria-labelledby="census-preliminary"
            className="flex max-w-[75ch] gap-3 rounded-lg border border-outline bg-surface-container-low p-4 text-sm"
          >
            <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-1">
              <p id="census-preliminary" className="font-semibold text-on-surface">
                {t("censusPreliminaryTitle")}
              </p>
              <p className="text-pretty text-on-surface-variant">
                {data.paired
                  ? t("censusPreliminary", { f1: format.number(data.paired.f1), articles: count(data.paired.articles) })
                  : t("censusPreliminaryUnscored")}
              </p>
              {!data.complete && <p className="font-semibold text-on-surface">{t("censusIncomplete")}</p>}
            </div>
          </aside>
        </header>

        <Section title={t("censusAdoptionTitle")} caption={t("censusAdoptionCaption", { year: newest ?? "" })}>
          <LineChart
            points={adoption}
            yMax={Math.max(...adoption.map((p) => p.y))}
            formatY={pct}
            label={t("censusAdoptionTitle")}
          />
          <h4 className="mt-8 text-sm font-semibold text-on-surface">{t("censusRolesPerAuthorTitle")}</h4>
          <p className="mt-1 max-w-[65ch] text-sm text-on-surface-variant">{t("censusRolesPerAuthorCaption")}</p>
          <LineChart
            points={perAuthor}
            yMax={Math.max(...perAuthor.map((p) => p.y))}
            formatY={(v) => format.number(v, { maximumFractionDigits: 1 })}
            label={t("censusRolesPerAuthorTitle")}
            height={160}
          />
          <TableToggle
            summary={t("censusShowTable")}
            columns={[
              t("censusYear"),
              t("censusResearchArticles"),
              t("censusWithRoles"),
              t("censusShare"),
              t("censusRolesPerAuthorTitle"),
            ]}
            rows={years.map((y) => [
              y.year,
              count(y.articles),
              count(y.with_roles),
              pct(y.with_roles / y.articles, 1),
              y.roles_per_author === null ? "–" : format.number(y.roles_per_author),
            ])}
          />
        </Section>

        <Section title={t("censusStylesTitle")} caption={t("censusStylesCaption")}>
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {STYLES.map((style) => {
              const [name, note] = STYLE_KEYS[style];
              return (
                <figure key={style}>
                  <figcaption>
                    <span className="block text-sm font-semibold text-on-surface">{t(name)}</span>
                    <span className="block text-xs text-on-surface-variant">{t(note)}</span>
                  </figcaption>
                  <LineChart
                    points={styleSeries[style]}
                    yMax={styleMax}
                    formatY={pct}
                    label={t(name)}
                    height={140}
                    compact
                  />
                </figure>
              );
            })}
          </div>
          <TableToggle
            summary={t("censusShowTable")}
            columns={[t("censusYear"), ...STYLES.map((s) => t(STYLE_KEYS[s][0]))]}
            rows={years.map((y) => [
              y.year,
              ...STYLES.map((s) => pct(styleSeries[s].find((p) => p.x === y.year)?.y ?? 0, 1)),
            ])}
          />
        </Section>

        <Section title={t("censusFieldsTitle")} caption={t("censusFieldsCaption", { year: data.focus_year ?? "" })}>
          <BarList bars={fields} formatShare={pct} />
        </Section>

        <Section
          title={t("censusPublishersTitle")}
          caption={t("censusPublishersCaption", { count: publishers.length, year: data.focus_year ?? "" })}
        >
          <BarList bars={publishers} formatShare={pct} />
        </Section>

        <Section title={t("censusRolesTitle")} caption={t("censusRolesCaption")}>
          {/* The table is the chart: each share is printed, its swatch only adds the shade. */}
          <section
            className="overflow-x-auto"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: on a narrow screen the table scrolls sideways and holds nothing focusable, so it needs a tab stop (axe scrollable-region-focusable).
            tabIndex={0}
            aria-label={t("censusRolesTitle")}
          >
            <table className="w-full min-w-[34rem] text-sm tabular-nums">
              <thead>
                <tr className="border-b border-outline text-xs text-on-surface-variant">
                  <th scope="col" className="py-2 pr-3 text-left font-semibold">
                    {t("censusRole")}
                  </th>
                  {PLACES.map((place) => (
                    <th key={place} scope="col" className="px-3 py-2 text-left font-semibold">
                      {t(PLACE_KEYS[place])}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {roles.map((role) => (
                  <tr key={role}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-on-surface">
                      {translateInterfaceRole(roleName(role))}
                    </th>
                    {PLACES.map((place) => {
                      const share = shares.get(`${role} ${place}`) ?? 0;
                      return (
                        <td key={place} className="px-3 py-1.5">
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="inline-block size-3.5 rounded-[3px] border border-outline-variant"
                              style={{
                                background: `color-mix(in oklab, var(--color-primary) ${Math.round((share / roleMax) * 100)}%, var(--color-surface-bright))`,
                              }}
                            />
                            <span className={place === "all" ? "font-semibold text-on-surface" : "text-on-surface"}>
                              {pct(share)}
                            </span>
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </Section>

        <footer className="space-y-3 border-t border-outline-variant pt-8 text-sm text-on-surface-variant">
          <h3 className="font-headline text-xl font-semibold text-on-surface">{t("censusAboutTitle")}</h3>
          <p className="max-w-[75ch] text-pretty">{t("censusMethod")}</p>
          <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt>{t("censusSnapshot")}</dt>
            <dd className="font-mono text-xs leading-5 text-on-surface">{data.snapshot}</dd>
            <dt>{t("censusDatasetVersion")}</dt>
            <dd className="font-mono text-xs leading-5 text-on-surface">{data.dataset_version}</dd>
            <dt>{t("censusCodeCommit")}</dt>
            <dd className="font-mono text-xs leading-5 text-on-surface">
              {data.code_commit ? (
                <a
                  href={`https://github.com/simonvanlierde/credit-matrix/commit/${data.code_commit}`}
                  className={IN_TEXT_LINK}
                >
                  {data.code_commit.slice(0, 7)}
                </a>
              ) : (
                "–"
              )}
            </dd>
            <dt>{t("censusOpenAlex")}</dt>
            <dd className="font-mono text-xs leading-5 text-on-surface">{data.openalex_sources ?? "–"}</dd>
          </dl>
          <p className="flex flex-wrap gap-x-5 gap-y-1">
            <a href="/data/census.json" download className={IN_TEXT_LINK}>
              {t("censusDownload")}
            </a>
            <a
              href={SOURCE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {t("censusSourceLink")}
              <ExternalLink className="size-3" aria-hidden="true" />
              <span className="sr-only">{t("opensInNewTab")}</span>
            </a>
          </p>
        </footer>
      </article>
    </div>
  );
}
