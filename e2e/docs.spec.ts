import { expect, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

/** The docs pages render the repo's Markdown (src/docs), with links between them as site routes. */
test.describe("Docs", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("the index lists the pages by section and opens one", async ({ page }) => {
    await page.goto("/docs");
    await expect(page).toHaveTitle("Documentation · CRediT Matrix");
    await expect(page.getByRole("heading", { level: 2, name: "Documentation" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([
      "Writing tools",
      "Data and exports",
      "Reference",
    ]);
    await page.getByRole("link", { name: "Quarto", exact: true }).click();

    await expect(page).toHaveURL(/\/docs\/quarto$/);
    await expect(page).toHaveTitle("CRediT statement for Quarto · CRediT Matrix");
    const article = page.locator("article");
    await expect(article).toHaveAttribute("lang", "en");
    await expect(article.getByRole("heading", { level: 2 })).toHaveText("CRediT statement for Quarto");
    // A relative link to another rendered file is its route; the nav marks this page.
    await expect(article.getByRole("link", { name: "Pandoc guide" })).toHaveAttribute("href", "/docs/pandoc");
    await expect(
      page.getByRole("navigation", { name: "Documentation" }).getByRole("link", { name: "Quarto", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("About points to the docs for each plugin's setup guide", async ({ page }) => {
    await page.goto("/about");
    await page.locator("article").getByRole("link", { name: "documentation", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/?$/);
  });

  test("no docs page scrolls sideways at 320 px, and option names stay whole", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/docs");
    const routes = await page
      .locator("main a[href^='/docs/']")
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href")))]);
    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) {
      await page.goto(route as string);
      // Text clipped by an ancestor never shows in scrollWidth, so measure every element against the viewport.
      const wide = await page
        .locator("article *")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
            .map((node) => node.outerHTML.slice(0, 80)),
        );
      expect(wide, route as string).toEqual([]);
    }
    await page.goto("/docs/heatmap");
    const optionHeights = await page
      .locator("article td:first-child code")
      .evaluateAll((codes) => codes.map((code) => code.getClientRects().length));
    expect(optionHeights.every((lines) => lines === 1)).toBe(true);
  });
});

test.describe("Docs without their sources", () => {
  // The pages are prerendered, so the browser needs neither the Markdown files nor the renderer.
  const sources = /\/assets\/(?:README|heatmap|element|markdown)-[\w-]+\.js$/;

  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  for (const route of ["/docs", "/docs/quarto", "/docs/typst"]) {
    test(`${route} hydrates without warnings and without the Markdown chunks`, async ({ page }) => {
      const messages: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") messages.push(message.text());
      });
      page.on("pageerror", (error) => messages.push(error.message));
      const blocked: string[] = [];
      await page.route(sources, (request) => {
        blocked.push(request.request().url());
        return request.abort();
      });
      await page.goto(route);
      // The header's menu opens only once React has hydrated the page.
      await page.getByRole("button", { name: "Language settings" }).click();
      await expect(page.getByRole("combobox", { name: "Interface language" })).toBeVisible();
      await expect(page.getByText("This page could not load")).toHaveCount(0);
      expect(blocked).toEqual([]);
      expect(messages).toEqual([]);
    });
  }

  test("a page keeps its article and nav and navigates", async ({ page }) => {
    await page.route(sources, (request) => request.abort());
    await page.goto("/docs/quarto");
    await page.getByRole("button", { name: "Language settings" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("article").getByRole("heading", { level: 2 })).toHaveText("CRediT statement for Quarto");
    const nav = page.getByRole("navigation", { name: "Documentation" });
    await expect(nav.getByRole("link", { name: "Quarto", exact: true })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Typst", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/typst$/);
    await expect(nav.getByRole("link", { name: "Typst", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("article img")).toHaveAttribute("loading", "lazy");
  });
});

test("desktop docs use the viewport with compact navigation and a working outline", async ({ page }) => {
  await asReturningVisitor(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/docs/quarto");
  const nav = page.getByRole("navigation", { name: "Documentation", exact: true }).first();
  const bounds = await nav.boundingBox();
  expect(bounds?.x).toBeLessThan(64);
  expect(bounds?.width).toBeGreaterThanOrEqual(260);
  const heading = nav.getByRole("heading", { name: "Writing tools", exact: true });
  expect(await heading.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeLessThanOrEqual(16);
  const outline = page.getByRole("navigation", { name: "On this page", exact: true });
  await outline.getByRole("link", { name: "Contribution heatmap", exact: true }).click();
  await expect(page).toHaveURL(/#contribution-heatmap$/);
  await expect(page.locator("#contribution-heatmap")).toBeInViewport();
});

test("the writing tool switcher is a list of links that marks the current guide", async ({ page }) => {
  await asReturningVisitor(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/quarto");
  const tools = page.getByRole("navigation", { name: "Writing tool", exact: true });
  const links = tools.getByRole("link");
  await expect(links).toHaveText(["Jupyter Book 2", "MyST", "Pandoc", "Quarto", "Sphinx", "Typst"]);
  // Links, not a select that navigates on change: no combobox, real hrefs, one current page.
  await expect(page.getByRole("combobox", { name: "Writing tool" })).toHaveCount(0);
  await expect(tools.getByRole("link", { name: "Typst", exact: true })).toHaveAttribute("href", "/docs/typst");
  await expect(tools.locator("[aria-current]")).toHaveCount(1);
  await expect(tools.getByRole("link", { name: "Quarto", exact: true })).toHaveAttribute("aria-current", "page");
  // The switcher sits close to the top on a phone, above the guide's title.
  const title = page.locator("article").getByRole("heading", { level: 2 });
  expect((await title.boundingBox())?.y).toBeLessThan(400);

  await tools.getByRole("link", { name: "Typst", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/typst$/);
  await expect(tools.getByRole("link", { name: "Typst", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/\/docs\/quarto$/);
  await expect(tools.getByRole("link", { name: "Quarto", exact: true })).toHaveAttribute("aria-current", "page");
});

test("wide screens switch tools from the rail, and the index lists the tools once", async ({ page }) => {
  await asReturningVisitor(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/docs/quarto");
  await expect(page.getByRole("navigation", { name: "Writing tool", exact: true })).toBeHidden();
  await page.goto("/docs");
  await expect(page.getByRole("navigation", { name: "Writing tool", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Writing tool" })).toHaveCount(0);
});

test("very wide screens keep the docs centred with a readable article and search", async ({ page }) => {
  await asReturningVisitor(page);
  await page.setViewportSize({ width: 2560, height: 1300 });
  await page.goto("/docs/typst");
  const article = await page.locator("article").boundingBox();
  const search = await page.getByRole("region", { name: "Search documentation" }).boundingBox();
  const outline = await page.getByRole("navigation", { name: "On this page", exact: true }).boundingBox();
  expect(article?.width).toBeLessThanOrEqual(1100);
  expect(search?.width).toBeLessThanOrEqual(768);
  // Centred: the outline ends as far from the right edge as the rail starts from the left.
  expect(2560 - ((outline?.x ?? 0) + (outline?.width ?? 0))).toBeGreaterThan(400);
});

test("phones reach the section outline from the documentation menu", async ({ page }) => {
  await asReturningVisitor(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/typst");
  const outline = page.getByRole("navigation", { name: "On this page", exact: true });
  await page.locator("details summary").filter({ hasText: "Documentation" }).click();
  await outline.getByRole("link", { name: "Use", exact: true }).click();
  await expect(page).toHaveURL(/#use$/);
  await expect(page.locator("article #use")).toBeInViewport();
});

test("moving between docs pages paints the search box, ground and header icons from the first frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(() => {
      const w = window as unknown as { docsFrames: string[] };
      w.docsFrames = [];
      const sample = () => {
        const search = document.querySelector(".docs-search input");
        const icons = document.querySelectorAll("[data-app-header] svg.lucide-moon, [data-app-header] svg.lucide-sun");
        const toggle = Array.from(icons).some((icon) => icon.getBoundingClientRect().width > 0);
        w.docsFrames.push(
          [
            search ? `${search.getBoundingClientRect().height}` : "no search box",
            getComputedStyle(document.body).backgroundColor,
            getComputedStyle(document.documentElement).getPropertyValue("--color-mark-0-100").trim(),
            toggle ? "theme icon" : "no theme icon",
            document.querySelectorAll('nav[aria-label="On this page"] a').length > 0 ? "outline" : "no outline",
          ].join(" | "),
        );
        if (w.docsFrames.length < 60) requestAnimationFrame(sample);
      };
      // From the parsed page on: frames during parsing show a half-read document, not a flash.
      document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(sample));
    });
    await page.goto("/docs/quarto");
    await page.locator("nav[data-docs-rail]").getByRole("link", { name: "Typst", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/typst$/);
    await expect(page.getByRole("region", { name: "Search documentation" }).getByRole("combobox")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { docsFrames: string[] }).docsFrames.length))
      .toBeGreaterThanOrEqual(60);
    const frames = await page.evaluate(() => (window as unknown as { docsFrames: string[] }).docsFrames);
    // Every frame of the new page, before and after its scripts run, looks the same.
    expect(new Set(frames), scheme).toEqual(new Set([frames.at(-1)]));
  }
});
