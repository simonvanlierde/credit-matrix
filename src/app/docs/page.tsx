import { ReadingPage } from "@/components/ReadingPage";
import { docFiles } from "@/docs/pages";
import { renderDoc } from "@/docs/render";
import { usePathname } from "@/lib/pathname";
import { useTranslations } from "@/lib/translations";

// Every docs page loads every file: the nav needs each title, and the files total about 20 kB gzipped.
const docs = await Promise.all(docFiles.map(async (file) => renderDoc(file, await file.load())));

/** The docs grouped by section: the index's content and each page's nav. Docs text is English. */
function DocsList({ current, details }: { current?: string; details?: boolean }) {
  const t = useTranslations();
  return (["howTo", "reference"] as const).map((section) => (
    <section key={section}>
      <h3>{t(section === "howTo" ? "docsHowTo" : "docsReference")}</h3>
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
  const html = docs.find((doc) => doc.route === route)?.html ?? "";
  return (
    <ReadingPage>
      <a href="/docs" className="text-sm text-primary hover:underline">
        {t("docsTitle")}
      </a>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown, rendered at build time */}
      <article lang="en" className="document" dangerouslySetInnerHTML={{ __html: html }} />
      <nav aria-label={t("docsTitle")} className="document">
        <DocsList current={route} />
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
