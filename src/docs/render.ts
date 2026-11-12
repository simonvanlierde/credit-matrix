import { imageSizes } from "virtual:docs";
import { renderMarkdown } from "@/lib/markdown";
import { images } from "./images";
import { type DocPart, splitLiveMarkers } from "./live-markers";
import { type DocFile, docFiles } from "./pages";

export const GITHUB = "https://github.com/simonvanlierde/credit-matrix";

// Each image's width and height by URL, so the page reserves its space before it loads.
const sizes = new Map(Object.entries(images).map(([path, url]) => [url, imageSizes[path]]));

// The rendered files by repo path, the accessibility statement included.
const routes = new Map<string, string>([
  ["docs/accessibility.md", "/accessibility"],
  ...docFiles.map((file) => [file.path, file.route] as const),
]);

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

/** Render static HTML and live targets, keeping reference links in one Markdown parse. */
export function renderDoc(file: DocFile, source: string): DocPart[] {
  const parts = splitLiveMarkers(source);
  const html = renderMarkdown(
    parts
      .map((part) => (typeof part === "string" ? part : `<div data-doc-live-slot="${part.live}"></div>\n\n`))
      .join(""),
    (href) => resolveHref(href, file.path),
    (src) => sizes.get(src),
  );
  const rendered: DocPart[] = [];
  let offset = 0;
  for (const marker of html.matchAll(/<div data-doc-live-slot="([a-z-]+)"><\/div>\n?/g)) {
    if (marker.index > offset) rendered.push(html.slice(offset, marker.index));
    const part = parts.find((candidate) => typeof candidate !== "string" && candidate.live === marker[1]);
    if (!part || typeof part === "string") throw new Error("Invalid rendered live target");
    rendered.push(part);
    offset = marker.index + marker[0].length;
  }
  if (offset < html.length || rendered.length === 0) rendered.push(html.slice(offset));
  return rendered;
}
