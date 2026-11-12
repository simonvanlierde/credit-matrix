import { docs } from "virtual:docs";
// The browser build emits the images the prerendered articles show; nothing here reads the map.
import "@/docs/images";
import { ArrowLeft } from "lucide-react";
import { ReadingPage } from "@/components/ReadingPage";
import { usePathname } from "@/lib/pathname";
import { useTranslations } from "@/lib/translations";

// The server renders each article from its Markdown; the browser keeps the prerendered article, so
// neither the sources nor the renderer ship to it. The dev server prerenders nothing and renders here.
const rendered =
  import.meta.env.SSR || import.meta.env.DEV
    ? await import("@/docs/render").then(
        ({ renderDoc }) => new Map<string, string>(docs.map((doc) => [doc.route, renderDoc(doc, doc.source ?? "")])),
      )
    : null;
// Read before hydration, so the client's __html is the server's DOM and React leaves it alone.
const prerendered = rendered ? "" : (document.querySelector("main article")?.innerHTML ?? "");

/** The docs grouped by section: the index's content and each page's nav. Docs text is English. */
function DocsList({ current, details, level = 3 }: { current?: string; details?: boolean; level?: 2 | 3 }) {
  const t = useTranslations();
  // On a doc page the README's own sections are h3, so the nav's groups sit at h2 beside them.
  const Heading = level === 2 ? "h2" : "h3";
  return (["howTo", "reference"] as const).map((section) => (
    <section key={section}>
      <Heading>{t(section === "howTo" ? "docsHowTo" : "docsReference")}</Heading>
      <ul>
        {docs
          .filter((doc) => doc.section === section)
          .map((doc) => (
            <li key={doc.route} lang="en">
              <a href={doc.route} aria-current={doc.route === current ? "page" : undefined}>
                {doc.title}
              </a>
              {details && <p>{doc.description}</p>}
            </li>
          ))}
      </ul>
    </section>
  ));
}

function DocsIndex() {
  const t = useTranslations();
  return (
    <ReadingPage>
      <div className="document">
        <h2>{t("docsTitle")}</h2>
        <DocsList details />
      </div>
    </ReadingPage>
  );
}

function DocPage() {
  const t = useTranslations();
  const route = usePathname();
  const html = rendered?.get(route) ?? prerendered;
  return (
    <ReadingPage>
      <a href="/docs" className="flex w-fit items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("docsTitle")}
      </a>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown from the repo */}
      <article lang="en" className="document" dangerouslySetInnerHTML={{ __html: html }} />
      <nav aria-label={t("docsTitle")} className="document">
        <DocsList current={route} level={2} />
      </nav>
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
