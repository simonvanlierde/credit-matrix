import { docs } from "virtual:docs";
// The browser build emits the images the prerendered articles show.
import "@/docs/images";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { DocsSearch } from "@/components/DocsSearch";
import { ReadingPage } from "@/components/ReadingPage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocArticle, readDocParts } from "@/docs/DocArticle";
import type { DocPart } from "@/docs/live-markers";
import { usePathname } from "@/lib/pathname";
import { useTranslations } from "@/lib/translations";

// Only the server and dev server render Markdown; the browser keeps the prerendered fragments.
const rendered =
  import.meta.env.SSR || import.meta.env.DEV
    ? await import("@/docs/render").then(
        ({ renderDoc }) => new Map<string, DocPart[]>(docs.map((doc) => [doc.route, renderDoc(doc, doc.source ?? "")])),
      )
    : null;
const prerendered = rendered ? [] : readDocParts(document.querySelector("main article"));

const sections = ["howTo", "data", "reference"] as const;
const sectionKeys = { howTo: "docsHowTo", data: "docsData", reference: "docsReference" } as const;
const labels: Record<string, string> = {
  "/docs/element": "Web component",
  "/docs/figures": "Figure fonts and PDF export",
  "/docs/heatmap": "Contribution heatmaps",
  "/docs/ro-crate": "RO-Crate attribution",
};
const docLabel = (doc: (typeof docs)[number]) => labels[doc.route] ?? doc.title.replace(/^CRediT statement for /, "");

function DocsList({ current, details = false }: { current?: string; details?: boolean }) {
  const t = useTranslations();
  const Heading = details ? "h3" : "h2";
  return sections.map((section) => (
    <section key={section} className="space-y-2">
      <Heading
        className={
          details ? "font-headline text-2xl font-semibold text-on-surface" : "text-sm font-semibold text-on-surface"
        }
      >
        {t(sectionKeys[section])}
      </Heading>
      <ul className={details ? "grid gap-5" : "grid gap-1"}>
        {docs
          .filter((doc) => doc.section === section)
          .map((doc) => (
            <li key={doc.route} lang="en">
              <a
                href={doc.route}
                aria-current={doc.route === current ? "page" : undefined}
                className={
                  details
                    ? "text-primary underline decoration-outline/50 underline-offset-4 hover:decoration-primary"
                    : "block rounded px-2 py-1.5 text-sm text-on-surface-variant hover:bg-surface-container-low hover:text-primary focus-visible:outline-2 focus-visible:outline-primary aria-[current=page]:bg-surface-container-low aria-[current=page]:font-semibold aria-[current=page]:text-primary"
                }
              >
                {docLabel(doc)}
              </a>
              {details && (
                <p className="mt-1 max-w-prose text-sm leading-relaxed text-on-surface-variant">{doc.description}</p>
              )}
            </li>
          ))}
      </ul>
    </section>
  ));
}

function WritingTool({ current }: { current?: string }) {
  const t = useTranslations();
  return (
    <div className="grid min-w-0 gap-2 sm:flex sm:items-center sm:gap-3">
      <span id="docs-writing-tool-label" className="text-sm font-semibold text-on-surface">
        {t("docsWritingTool")}
      </span>
      <Select value={current ?? ""} onValueChange={(route) => window.location.assign(route)}>
        <SelectTrigger aria-labelledby="docs-writing-tool-label" size="touch" className="w-full sm:w-60">
          <SelectValue placeholder={t("docsWritingTool")} />
        </SelectTrigger>
        <SelectContent>
          {docs
            .filter((doc) => doc.section === "howTo")
            .map((doc) => (
              <SelectItem key={doc.route} value={doc.route} size="touch">
                {docLabel(doc)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DocOutline() {
  const t = useTranslations();
  const [headings, setHeadings] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    setHeadings(
      Array.from(document.querySelectorAll("article h3[id]"), (heading) => ({
        id: heading.id,
        title: heading.textContent ?? "",
      })),
    );
  }, []);
  if (headings.length < 2) return null;
  return (
    <nav aria-label={t("docsOnPage")} className="hidden space-y-3 xl:sticky xl:top-6 xl:block">
      <h2 className="text-sm font-semibold text-on-surface">{t("docsOnPage")}</h2>
      <ul lang="en" className="grid gap-2 text-sm text-on-surface-variant">
        {headings.map(({ id, title }) => (
          <li key={id}>
            <a
              className="hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
              href={`#${id}`}
            >
              {title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DocsIndex() {
  const t = useTranslations();
  return (
    <ReadingPage wide>
      <div className="space-y-8">
        <h2 className="font-headline text-4xl font-semibold text-on-surface sm:text-5xl">{t("docsTitle")}</h2>
        <div className="max-w-3xl space-y-6">
          <DocsSearch />
          <WritingTool />
        </div>
        <div className="grid items-start gap-10 border-t border-outline-variant pt-8 md:grid-cols-3">
          <DocsList details />
        </div>
      </div>
    </ReadingPage>
  );
}

function DocPage() {
  const t = useTranslations();
  const route = usePathname();
  const doc = docs.find((entry) => entry.route === route);
  const parts = rendered?.get(route) ?? prerendered;
  return (
    <ReadingPage wide>
      <meta name="pagefind:title" data-pagefind-meta="title[content]" content={doc?.title} />
      <meta name="pagefind:url" data-pagefind-meta="url[content]" content={route} />
      <div className="docs-layout grid items-start gap-8">
        <nav aria-label={t("docsTitle")} className="hidden space-y-7 lg:sticky lg:top-6 lg:block">
          <DocsList current={route} />
        </nav>
        <div className="min-w-0 space-y-6">
          <a href="/docs" className="flex w-fit items-center gap-1.5 text-sm text-primary hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("docsTitle")}
          </a>
          <DocsSearch />
          {doc?.section === "howTo" && <WritingTool current={route} />}
          <details className="lg:hidden">
            <summary className="cursor-pointer py-2 text-sm font-semibold text-primary">{t("docsTitle")}</summary>
            <nav aria-label={t("docsTitle")} className="grid gap-6 pt-4">
              <DocsList current={route} />
            </nav>
          </details>
          <DocArticle parts={parts} />
        </div>
        <DocOutline key={route} />
      </div>
    </ReadingPage>
  );
}

export const docsIndex = () => ({
  default: DocsIndex,
  metadata: {
    title: "Documentation · CRediT Matrix",
    description:
      "Add a CRediT statement and contribution heatmap to Quarto, Pandoc, Typst, MyST, Sphinx and other writing tools.",
    alternates: { canonical: "/docs" },
  },
});

export function docPage(route: string) {
  const doc = docs.find((entry) => entry.route === route);
  if (!doc) throw new Error(`no doc for ${route}`);
  return {
    default: DocPage,
    metadata: { title: `${doc.title} · CRediT Matrix`, description: doc.description, alternates: { canonical: route } },
  };
}
