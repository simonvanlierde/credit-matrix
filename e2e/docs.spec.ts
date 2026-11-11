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
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Use it in your writing tool", "Reference"]);
    await page.getByRole("link", { name: "CRediT statement for Quarto" }).click();

    await expect(page).toHaveURL(/\/docs\/quarto$/);
    await expect(page).toHaveTitle("CRediT statement for Quarto · CRediT Matrix");
    const article = page.locator("article");
    await expect(article).toHaveAttribute("lang", "en");
    await expect(article.getByRole("heading", { level: 2 })).toHaveText("CRediT statement for Quarto");
    // A relative link to another rendered file is its route; the nav marks this page.
    await expect(article.getByRole("link", { name: "Pandoc guide" })).toHaveAttribute("href", "/docs/pandoc");
    await expect(
      page
        .getByRole("navigation", { name: "Documentation" })
        .getByRole("link", { name: "CRediT statement for Quarto" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("About links each plugin to its docs page", async ({ page }) => {
    await page.goto("/about");
    await page.getByRole("link", { name: "Quarto", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/quarto$/);
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
