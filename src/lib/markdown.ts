import { Marked } from "marked";

/** GitHub's heading anchors, so a link to a section works on GitHub and on the site alike. */
export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/**
 * Renders one of the repo's Markdown files for a reading page. The file stays the one copy: GitHub
 * shows it, and the build renders it here. `href` rewrites every link and image target.
 */
export function renderMarkdown(source: string, href = (target: string) => target) {
  const markdown = new Marked({
    walkTokens(token) {
      // The header's brand is the page's h1, so the file's own levels move down one.
      if (token.type === "heading") token.depth = Math.min(token.depth + 1, 6);
      if (token.type === "link" || token.type === "image") token.href = href(token.href);
    },
    renderer: {
      // Maintainer comments stay out of the page.
      html({ text }) {
        return text.trimStart().startsWith("<!--") ? "" : text;
      },
      heading({ tokens, depth, text }) {
        return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  });
  return markdown.parse(source, { async: false });
}
