import { imageSizes } from "virtual:docs";
import { renderMarkdown } from "@/lib/markdown";
import { images } from "./images";
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

/** The page HTML of the repo file `file`, with its links and images pointing at the site. */
export function renderDoc(file: DocFile, source: string) {
  return renderMarkdown(
    source,
    (href) => resolveHref(href, file.path),
    (src) => sizes.get(src),
  );
}
