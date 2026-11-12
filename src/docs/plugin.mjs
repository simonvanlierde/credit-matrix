// biome-ignore-all lint/correctness/noNodejsModules: a Vite plugin, run by the build in Node.
// Plain ESM JavaScript, so the Vite and Vitest configs load it without a transpile step.
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Lexer } from "marked";

/**
 * The Markdown files the site renders under /docs. A new integrations/<tool>/README.md is a new page
 * at /docs/<tool> with no other edit. How-to pages are one per writing tool; the figure font guide is
 * reference, not a tool, and the CodeMeta README describes a maintainer test.
 */
const SECTIONS = {
  howTo: { include: ["integrations/*/README.md"], exclude: ["integrations/{figures,codemeta}/README.md"] },
  reference: { include: ["integrations/heatmap.md", "integrations/figures/README.md", "docs/element.md"], exclude: [] },
};

// The Typst README's title is the package name, as Typst Universe shows it; in the docs list it needs the tool's.
const TITLES = { "integrations/typst/README.md": "CRediT statement for Typst" };

/**
 * Two modules, so the app entry carries the route list and nothing else:
 * - `virtual:doc-files`: each file's path, route and section (src/docs/pages.ts).
 * - `virtual:docs`: adds each page's title and description, all the docs nav needs. The server build,
 *   the dev server and the tests also get each file's `source` to render, and `imageSizes`, the width
 *   and height of each bundled docs image. The browser build gets neither: pages are prerendered.
 * @returns {import("vite").Plugin}
 */
export function docsPlugin() {
  let root = process.cwd();
  let serve = false;
  const files = () =>
    Object.entries(SECTIONS).flatMap(([section, { include, exclude }]) =>
      globSync(include, { cwd: root, exclude })
        .sort()
        .map((path) => {
          // integrations/quarto/README.md is /docs/quarto; integrations/heatmap.md is /docs/heatmap.
          const name = path
            .replace(/\/README\.md$/, "")
            .replace(/\.md$/, "")
            .split("/")
            .at(-1);
          return { path, route: `/docs/${name}`, section };
        }),
    );
  return {
    name: "docs",
    configResolved(config) {
      root = config.root;
      serve = config.command === "serve";
    },
    resolveId(id) {
      if (id === "virtual:doc-files" || id === "virtual:docs") return `\0${id}`;
    },
    load(id, options) {
      if (id === "\0virtual:doc-files") return `export const docFiles = ${JSON.stringify(files())};`;
      if (id !== "\0virtual:docs") return;
      const withSource = serve || Boolean(options?.ssr);
      const docs = files().map((file) => {
        const source = readFileSync(join(root, file.path), "utf8");
        this.addWatchFile(join(root, file.path));
        return { ...file, ...docMeta(file.path, source), ...(withSource && { source }) };
      });
      const imageSizes = withSource
        ? Object.fromEntries(
            globSync("integrations/*/examples/*.{png,jpg,svg,webp}", { cwd: root }).map((path) => [
              path,
              pngSize(readFileSync(join(root, path)), path),
            ]),
          )
        : {};
      return `export const docs = ${JSON.stringify(docs)};\nexport const imageSizes = ${JSON.stringify(imageSizes)};`;
    },
  };
}

/** Text without Markdown: for a page title and description. */
const plain = (tokens) =>
  tokens
    .map((token) => (token.tokens ? plain(token.tokens) : (token.text ?? "")))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The opening sentences that fit a search snippet's 160 characters; always the first one.
 * @param {string} text
 */
export function snippet(text) {
  let out = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    // A sentence ending in a colon introduces a block the snippet leaves out.
    if (out && (out.length + sentence.length >= 160 || sentence.endsWith(":"))) break;
    out = `${out} ${sentence}`.trim();
  }
  return out;
}

/** A docs page's title, and its first paragraph's opening sentences as the description. */
function docMeta(path, source) {
  const tokens = Lexer.lex(source);
  const heading = tokens.find((token) => token.type === "heading" && token.depth === 1);
  const paragraph = tokens.find((token) => token.type === "paragraph");
  if (!(heading?.tokens && paragraph?.tokens)) throw new Error(`${path} needs a # title and a first paragraph`);
  return { title: TITLES[path] ?? plain(heading.tokens), description: snippet(plain(paragraph.tokens)) };
}

// shortcut: reads PNG headers only, the one docs image format in use; add a reader when a JPEG, SVG or WebP lands.
function pngSize(bytes, path) {
  if (bytes.toString("latin1", 1, 4) !== "PNG") throw new Error(`docs: ${path} is no PNG; teach pngSize its format`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
