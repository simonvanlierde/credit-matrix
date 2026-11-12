/**
 * The Markdown files the site renders under /docs, and the one list routes.ts, the prerender, the
 * service worker and the sitemap take their paths from. A new integrations/<tool>/README.md is a new
 * page at /docs/<tool> with no other edit.
 */

// How-to pages: one per writing tool. The figure font guide is reference, not a tool, and the CodeMeta
// README describes a maintainer test.
const howTo = import.meta.glob<string>(
  ["../../integrations/*/README.md", "!../../integrations/{figures,codemeta}/README.md"],
  {
    query: "?raw",
    import: "default",
  },
);
const reference = import.meta.glob<string>(
  ["../../integrations/heatmap.md", "../../integrations/figures/README.md", "../../docs/element.md"],
  { query: "?raw", import: "default" },
);

export type DocSection = "howTo" | "reference";

export interface DocFile {
  /** Path from the repo root, as GitHub and relative links name it. */
  path: string;
  route: `/docs/${string}`;
  section: DocSection;
  load: () => Promise<string>;
}

const files = (section: DocSection, glob: Record<string, () => Promise<string>>): DocFile[] =>
  Object.entries(glob).map(([key, load]) => {
    const path = key.replace(/^(?:\.\.\/)+/, "");
    // integrations/quarto/README.md is /docs/quarto; integrations/heatmap.md is /docs/heatmap.
    const name = path
      .replace(/\/README\.md$/, "")
      .replace(/\.md$/, "")
      .split("/")
      .at(-1);
    return { path, route: `/docs/${name}`, section, load };
  });

export const docFiles = [...files("howTo", howTo), ...files("reference", reference)];
