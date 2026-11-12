// biome-ignore-all lint/correctness/noNodejsModules: the test reads the repo's files.
import { existsSync, readFileSync, statSync } from "node:fs";
import { docs } from "virtual:docs";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Lexer, marked } from "marked";
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderMarkdown } from "@/lib/markdown";
import { routes } from "@/routes";
import { DocArticle, readDocParts } from "./DocArticle";
import type { DocPart } from "./live-markers";
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
    const html = renderDoc(doc, `<!-- note to self -->\n${doc.source}`)
      .filter((part) => typeof part === "string")
      .join("");
    expect(html).toContain('<h2 id="credit-statement-for-quarto">');
    expect(html).not.toContain("note to self");
  });
});

test("a docs image loads lazily with its intrinsic size", () => {
  const file = docFiles.find(({ route }) => route === "/docs/typst");
  if (!file) throw new Error("no typst page");
  const html = renderDoc(file, readFileSync(file.path, "utf8"))
    .filter((part) => typeof part === "string")
    .join("");
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

describe("live docs parts", () => {
  const file = docFiles.find(({ route }) => route === "/docs/quarto");
  if (!file) throw new Error("no quarto page");

  test("renders ordered static parts and live targets before comments disappear", () => {
    expect(renderDoc(file, "First.\n\n<!-- live: quarto -->\n\nLast.")).toEqual([
      "<p>First.</p>\n",
      { live: "quarto" },
      "<p>Last.</p>\n",
    ]);
  });

  test.each([
    ["# Next heading", '<h2 id="next-heading">Next heading</h2>'],
    ["```yaml\nauthor: Example\n```", '<pre><code class="language-yaml">author: Example\n</code></pre>'],
  ])("renders Markdown immediately after a live marker: %s", (markdown, expected) => {
    const parts = renderDoc(file, `<!-- live: quarto -->\n${markdown}`);
    expect(parts[0]).toEqual({ live: "quarto" });
    expect(parts.filter((part) => typeof part === "string").join("")).toContain(expected);
  });

  test("preserves Markdown references across a live marker", () => {
    const parts = renderDoc(file, "[Guide][guide]\n\n<!-- live: quarto -->\n\n[guide]: ../myst/README.md#use");
    expect(parts[0]).toContain('<a href="/docs/myst#use">Guide</a>');
    expect(parts[1]).toEqual({ live: "quarto" });
  });

  test("unmarked pages retain the same HTML", () => {
    const source = "# Guide\n\n<!-- maintainer note -->\n\nA paragraph.";
    expect(renderDoc(file, source)).toEqual([renderMarkdown(source)]);
  });

  test("keeps repeated targets in source order", () => {
    const parts = renderDoc(file, "<!-- live: quarto -->\n\nBetween.\n\n<!-- live: quarto -->");
    expect(parts).toEqual([{ live: "quarto" }, "<p>Between.</p>\n", { live: "quarto" }]);
  });

  test("fails the build on an unknown live target", () => {
    expect(() => renderDoc(file, "<!-- live: typo -->")).toThrow("Invalid live target");
  });
});

test("the seven integration guides declare their matching live output without losing static examples", () => {
  for (const [tool, target] of [
    ["quarto", "quarto"],
    ["pandoc", "pandoc"],
    ["myst", "myst"],
    ["jupyter-book", "myst"],
    ["typst", "typst"],
    ["sphinx", "sphinx"],
    ["ro-crate", "ro-crate"],
  ]) {
    const file = docFiles.find((entry) => entry.path === `integrations/${tool}/README.md`);
    if (!file) throw new Error(`no ${tool} page`);
    const parts = renderDoc(file, readFileSync(file.path, "utf8"));
    expect(parts.filter((part) => typeof part !== "string")).toEqual([{ live: target }]);
    expect(parts.filter((part) => typeof part === "string").join("")).toContain("<pre><code");
  }
});

const { loadedLive } = vi.hoisted(() => ({ loadedLive: vi.fn() }));
vi.mock("./LiveExample", () => {
  loadedLive();
  return {
    default: ({ target }: { target: string }) => {
      if (target === "typst") throw new Error("Live chunk failed");
      return createElement("p", null, `Live ${target}`);
    },
  };
});
afterEach(cleanup);

describe("prerendered docs hydration", () => {
  test("an unmarked page keeps its opaque HTML without loading a live component", () => {
    const parts = ["<h2>Guide</h2>\n<p>Static &amp; readable.</p>\n"];
    const html = renderToString(createElement(DocArticle, { parts }));
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(readDocParts(container.querySelector("article"))).toEqual(parts);
    render(createElement(DocArticle, { parts }));
    expect(loadedLive).not.toHaveBeenCalled();
  });

  test("repeated live slots retain ordered static fragments and hydrate without recovery", async () => {
    const parts: DocPart[] = ["<h2>Guide</h2>\n", { live: "quarto" }, "\n<p>A &amp; B.</p>\n", { live: "quarto" }];
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(DocArticle, { parts }));
    document.body.append(container);
    const recovered = readDocParts(container.querySelector("article"));
    expect(recovered).toEqual(parts);
    expect(container.querySelectorAll("[data-doc-live][data-pagefind-ignore]")).toHaveLength(2);
    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(() => {
      root = hydrateRoot(container, createElement(DocArticle, { parts: recovered }), { onRecoverableError });
    });
    await waitFor(() => expect(container.textContent).toContain("Live quarto"));
    expect(container.querySelectorAll("[data-doc-live] p")).toHaveLength(2);
    expect(onRecoverableError).not.toHaveBeenCalled();
    await act(() => root?.unmount());
    container.remove();
  });

  test("a failed live component leaves the static guide readable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(createElement(DocArticle, { parts: ["<p>Readable setup.</p>", { live: "typst" }] }));
    await waitFor(() => expect(screen.getByText("Readable setup.")).toBeTruthy());
    expect(document.querySelector("[data-doc-live]")?.textContent).toBe("");
  });
});
