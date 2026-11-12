// biome-ignore-all lint/correctness/noNodejsModules: the test reads the repo's files.
import { existsSync, readFileSync, statSync } from "node:fs";
import { docs } from "virtual:docs";
import { Lexer, marked } from "marked";
import { describe, expect, test } from "vitest";
import { renderMarkdown } from "@/lib/markdown";
import { routes } from "@/routes";
import { docFiles } from "./pages";
import { snippet } from "./plugin.mjs";
import { GITHUB, renderDoc, resolveHref } from "./render";

const targets = (path: string) => {
  const found: { href: string; image: boolean }[] = [];
  marked.walkTokens(Lexer.lex(readFileSync(path, "utf8")), (token) => {
    if (token.type === "link" || token.type === "image")
      found.push({ href: token.href, image: token.type === "image" });
  });
  return found;
};

describe("docs links", () => {
  test("every docs page has its own route", () => {
    expect(new Set(docFiles.map((file) => file.route)).size).toBe(docFiles.length);
    for (const file of docFiles) expect(routes).toHaveProperty([file.route]);
  });

  test.each(docFiles.map((file) => file.path))("%s: each relative link is a site page or a file on GitHub", (path) => {
    const relative = targets(path).filter(({ href }) => !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href));
    for (const { href, image } of relative) {
      const resolved = resolveHref(href, path);
      const where = `${path} links to ${href}`;
      if (image) {
        // A GitHub page is no image: an image must ship with the site.
        expect(resolved.startsWith(GITHUB), `${where}; keep images in integrations/*/examples/`).toBe(false);
      } else if (resolved.startsWith(GITHUB)) {
        const [, kind, target] =
          resolved.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(blob|tree)\/main\/([^#]+)/) ?? [];
        expect(target && existsSync(target), `${where}, which does not exist`).toBe(true);
        const folder = statSync(target as string).isDirectory();
        expect(kind, `${where}; end a folder link with / and a file link without`).toBe(folder ? "tree" : "blob");
      } else {
        expect(routes, `${where}, which is no site page`).toHaveProperty([resolved.replace(/#.*/, "")]);
      }
    }
  });
});

describe("resolveHref", () => {
  test("maps rendered files to routes and the rest to GitHub", () => {
    const from = "integrations/myst/README.md";
    expect(resolveHref("../heatmap.md#your-own-font", from)).toBe("/docs/heatmap#your-own-font");
    expect(resolveHref("../quarto/", from)).toBe("/docs/quarto");
    expect(resolveHref("../../docs/accessibility.md", from)).toBe("/accessibility");
    expect(resolveHref("example/", from)).toBe(`${GITHUB}/tree/main/integrations/myst/example`);
    expect(resolveHref("../../src/core/README.md#cli", from)).toBe(`${GITHUB}/blob/main/src/core/README.md#cli`);
    expect(resolveHref("#install", from)).toBe("#install");
    expect(resolveHref("https://quarto.org", from)).toBe("https://quarto.org");
    expect(resolveHref("../../src/core/cli.ts?plain=1#L3", from)).toBe(
      `${GITHUB}/blob/main/src/core/cli.ts?plain=1#L3`,
    );
    expect(resolveHref("../../", from)).toBe(`${GITHUB}/tree/main/`);
  });

  test("keeps GitHub's underscores in anchors and caps heading depth at h6", () => {
    const html = renderMarkdown("## my_option\n\n###### Deep");
    expect(html).toContain('<h3 id="my_option">');
    expect(html).toContain('<h6 id="deep">');
  });

  test("a docs page has its title, description and no maintainer comments", () => {
    const doc = docs.find(({ route }) => route === "/docs/quarto");
    if (!doc) throw new Error("no quarto page");
    expect(doc.title).toBe("CRediT statement for Quarto");
    expect(doc.description).toMatch(/^A Quarto filter that turns/);
    expect(docs.find(({ route }) => route === "/docs/typst")?.title).toBe("CRediT statement for Typst");
    const html = renderDoc(doc, `<!-- note to self -->\n${doc.source}`);
    expect(html).toContain('<h2 id="credit-statement-for-quarto">');
    expect(html).not.toContain("note to self");
  });
});

test("a docs image loads lazily with its intrinsic size", () => {
  const file = docFiles.find(({ route }) => route === "/docs/typst");
  if (!file) throw new Error("no typst page");
  const html = renderDoc(file, readFileSync(file.path, "utf8"));
  expect(html).toMatch(/<img loading="lazy" width="\d+" height="\d+" src="[^"]+basic[^"]*\.png" alt="/);
});

test("without a size, an image still loads lazily and keeps its target", () => {
  const html = renderMarkdown("[guide](a.md)\n\n![Figure](b.png)");
  expect(html).toContain('<a href="a.md">');
  expect(html).toContain('<img loading="lazy" src="b.png" alt="Figure">');
});

test("a description stops at the first sentence that does not fit 160 characters", () => {
  const long = "x".repeat(160);
  expect(snippet(`One. ${long}. Two.`)).toBe("One.");
  expect(snippet(`${long} ${long}. Two.`)).toBe(`${long} ${long}.`);
  expect(snippet("One. Two.")).toBe("One. Two.");
  expect(snippet("One. Two:")).toBe("One.");
});
