import { Lexer, type Token } from "marked";
import { renderMarkdown } from "@/lib/markdown";
import { type DocFile, docFiles } from "./pages";

export const GITHUB = "https://github.com/simonvanlierde/credit-matrix";

// Images ship with the site, so the strict img-src CSP holds and a page view asks no other host.
// Only these folders are bundled; the link test fails on an image anywhere else.
const images = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../integrations/*/examples/*.{png,jpg,svg,webp}", {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([key, url]) => [key.replace(/^(?:\.\.\/)+/, ""), url]),
);

// The rendered files by repo path, the accessibility statement included.
const routes = new Map<string, string>([
  ["docs/accessibility.md", "/accessibility"],
  ...docFiles.map((file) => [file.path, file.route] as const),
]);

// The Typst README's title is the package name, as Typst Universe shows it; in the docs list it needs the tool's.
const TITLES: Record<string, string> = { "integrations/typst/README.md": "CRediT statement for Typst" };

const ABSOLUTE = /^(?:[a-z][a-z\d+.-]*:|\/|#)/i;

/**
 * Where a link or image in the repo file at `from` points on the site. A rendered file becomes its
 * route, anchor kept; a bundled image its URL; anything else its GitHub page. A target that ends in
 * `/` is a folder (GitHub's tree view); any other is a file (blob view).
 */
export function resolveHref(href: string, from: string): string {
  if (ABSOLUTE.test(href)) return href;
  const url = new URL(href, `https://repo.invalid/${from}`);
  const path = decodeURIComponent(url.pathname.slice(1));
  const route = routes.get(path) ?? routes.get(`${path}README.md`);
  if (route) return route + url.search + url.hash;
  if (images[path]) return images[path];
  const view = path === "" || path.endsWith("/") ? "tree" : "blob";
  return `${GITHUB}/${view}/main/${path.replace(/\/$/, "")}${url.search}${url.hash}`;
}

/** Text without Markdown: for a page title and description. */
const plain = (tokens: Token[]): string =>
  tokens
    .map((token) => ("tokens" in token && token.tokens ? plain(token.tokens) : "text" in token ? token.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** The opening sentences that fit a search snippet's 160 characters; always the first one. */
export function snippet(text: string) {
  let out = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    // A sentence ending in a colon introduces a block the snippet leaves out.
    if (out && (out.length + sentence.length >= 160 || sentence.endsWith(":"))) break;
    out = `${out} ${sentence}`.trim();
  }
  return out;
}

export interface Doc extends Omit<DocFile, "load"> {
  title: string;
  /** The first paragraph's opening sentences, up to a search snippet's 160 characters. */
  description: string;
  html: string;
}

export function renderDoc(file: DocFile, source: string): Doc {
  const tokens = Lexer.lex(source);
  const heading = tokens.find((token) => token.type === "heading" && token.depth === 1);
  const paragraph = tokens.find((token) => token.type === "paragraph");
  if (!(heading && "tokens" in heading && paragraph && "tokens" in paragraph))
    throw new Error(`${file.path} needs a # title and a first paragraph`);
  return {
    path: file.path,
    route: file.route,
    section: file.section,
    title: TITLES[file.path] ?? plain(heading.tokens ?? []),
    description: snippet(plain(paragraph.tokens ?? [])),
    html: renderMarkdown(source, (href) => resolveHref(href, file.path)),
  };
}
