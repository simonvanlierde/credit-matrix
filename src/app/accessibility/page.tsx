import { ReadingPage } from "@/components/ReadingPage";
import { renderMarkdown } from "@/lib/markdown";
import source from "../../../docs/accessibility.md?raw";

export const metadata = {
  title: "Accessibility statement · CRediT Matrix",
  description: "What we check, the problems we know about, and how to report a barrier in CRediT Matrix.",
  alternates: { canonical: "/accessibility" },
};

const html = renderMarkdown(source);

export default function AccessibilityStatement() {
  return (
    <ReadingPage>
      {/* The statement is English only, whatever the interface language. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown, rendered at build time */}
      <article lang="en" className="document" dangerouslySetInnerHTML={{ __html: html }} />
    </ReadingPage>
  );
}
