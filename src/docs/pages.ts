import { docFiles as files } from "virtual:doc-files";

/**
 * The Markdown files the site renders under /docs (the list lives in ./plugin.mjs), and the one list
 * routes.ts, the prerender, the service worker and the sitemap take their paths from.
 */
export type DocSection = "howTo" | "reference";

export interface DocFile {
  /** Path from the repo root, as GitHub and relative links name it. */
  path: string;
  route: `/docs/${string}`;
  section: DocSection;
}

export const docFiles: DocFile[] = files;
