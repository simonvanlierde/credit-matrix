// biome-ignore lint/correctness/noNodejsModules: read at build time; the page ships as static HTML.
import { readFileSync } from "node:fs";
import { Marked } from "marked";
import type { Metadata } from "next";
import { ReadingPage } from "@/components/ReadingPage";

export const metadata: Metadata = {
  title: "Accessibility statement · CRediT Matrix",
  description: "What we check, the problems we know about, and how to report a barrier in CRediT Matrix.",
};

/** GitHub's heading anchors, so a link to a section works on GitHub and on the site alike. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

const markdown = new Marked({
  // The header's brand is the page's h1, so the statement's own levels move down one.
  walkTokens(token) {
    if (token.type === "heading") token.depth += 1;
  },
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

// docs/accessibility.md is the one copy: GitHub shows the file, and the build renders it here.
const html = markdown.parse(readFileSync("docs/accessibility.md", "utf8"), {
  async: false,
});

export default function AccessibilityStatement() {
  return (
    <ReadingPage>
      {/* The statement is English only, whatever the interface language. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown, rendered at build time */}
      <article lang="en" className="document" dangerouslySetInnerHTML={{ __html: html }} />
    </ReadingPage>
  );
}
