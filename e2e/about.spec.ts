// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

const conceptDoi = readFileSync("CITATION.cff", "utf8").match(/^doi: "(.+)"$/m)?.[1];

test.describe("About page", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("is linked from the About panel, cites the concept DOI, and gives privacy its own section", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "About this app" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "About, citing and privacy" }).click();
    await expect(page).toHaveURL(/\/about\/?$/);
    await expect(page).toHaveTitle(/^About/);

    const article = page.locator("article");
    await expect(article.getByRole("heading", { level: 2 })).toHaveText("About CRediT Matrix");
    await expect(article.getByRole("heading", { level: 3 })).toHaveText([
      "Cite CRediT Matrix",
      "Acknowledgements",
      "Privacy",
      "Accessibility",
    ]);
    expect(conceptDoi).toBeTruthy();
    await expect(article.getByRole("link", { name: `https://doi.org/${conceptDoi}` })).toBeVisible();
    await expect(page.locator("#privacy + p")).toContainText("Nothing else leaves your browser");
    await expect(article.getByRole("link", { name: "accessibility statement" })).toHaveAttribute(
      "href",
      "/accessibility",
    );
    // The page holds no draft, so the header offers no draft actions.
    await expect(page.getByRole("button", { name: "Import" })).toBeHidden();
  });

  // The welcome modal exists only on the main page, so from here "How it works"
  // has to take the visitor there and open it, in the nav and in the brand menu.
  for (const { label, width, open } of [
    { label: "header nav", width: 1280, open: async (_page: Page) => undefined },
    {
      label: "brand menu",
      width: 390,
      open: (page: Page) => page.getByRole("heading", { name: "CRediT Matrix" }).getByRole("button").click(),
    },
  ]) {
    test(`"How it works" in the ${label} opens the welcome panel from this page`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/about");
      await open(page);
      await page.getByRole("link", { name: "How it works" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("dialog", { name: /three steps/ })).toBeVisible();
      // The hash is dropped, so a reload after closing does not reopen it.
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(page.locator("dialog#getting-started")).toBeHidden();
    });
  }
});
