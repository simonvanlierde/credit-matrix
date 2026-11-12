import { Marked, Renderer } from "marked";

/** GitHub's heading anchors, so a link to a section works on GitHub and on the site alike. */
export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/**
 * Renders one of the repo's Markdown files for a reading page. The file stays the one copy: GitHub
 * shows it, and the build renders it here. `href` rewrites every link and image target; `size` gives
 * an image's intrinsic width and height by its rewritten target.
 */
export function renderMarkdown(
  source: string,
  href = (target: string) => target,
  size: (src: string) => { width: number; height: number } | undefined = () => undefined,
) {
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
      // Images sit below the fold: load them late, and reserve their box so the text does not shift.
      image(token) {
        const box = size(token.href);
        const attributes = `loading="lazy"${box ? ` width="${box.width}" height="${box.height}"` : ""}`;
        return Renderer.prototype.image.call(this, token).replace(/^<img /, `<img ${attributes} `);
      },
    },
  });
  return markdown.parse(source, { async: false });
}
