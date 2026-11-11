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
});
