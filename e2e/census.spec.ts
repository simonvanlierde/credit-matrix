import { expect, test } from "@playwright/test";
import data from "../public/data/census.json";
import { asReturningVisitor, scan } from "./helpers";

test.describe("CRediT census page", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("is linked from the header and About, and shows the counts with their provenance", async ({ page }) => {
    await page.goto("/");
    // The header link shows from xl; the default 1280 px viewport is xl.
    await expect(page.getByRole("banner").getByRole("link", { name: "CRediT census" })).toHaveAttribute(
      "href",
      "/census",
    );
    await page.getByRole("button", { name: "About this app" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /CRediT census/ })
      .click();
    await expect(page).toHaveURL(/\/census\/?$/);

    await expect(page.getByRole("heading", { name: "CRediT census", exact: true })).toBeVisible();
    await expect(page.getByText("Preliminary figures")).toBeVisible();
    // Two decimals, as the Published practice tab prints it.
    const f1 = (data.paired?.f1 ?? Number.NaN).toFixed(2);
    await expect(page.getByText(`F1 score of ${f1} `)).toBeVisible();
    await expect(page.getByText(data.snapshot, { exact: true })).toBeVisible();
    await expect(page.getByText(data.dataset_version, { exact: true })).toBeVisible();
    await expect(page.getByText(data.openalex_sources ?? "", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Adoption over time" })).toBeVisible();
    // Role names come from the CRediT catalog, not the census slugs.
    await expect(page.getByRole("rowheader", { name: "Writing – review & editing" })).toBeVisible();
    await expect(page.getByText(data.publishers[0]?.publisher ?? "")).toBeVisible();
    // The page holds no draft, so the header offers no draft actions.
    await expect(page.getByRole("button", { name: "Import" })).toBeHidden();

    await page.getByText("Show as a table").first().click();
    await expect(page.getByRole("region", { name: "Adoption over time, as a table" })).toBeVisible();
  });

  test("says how it reads statements, with links to the code and the model card", async ({ page }) => {
    await page.goto("/census");
    const how = page.getByRole("region", { name: "How the census reads statements" });
    await expect(how.getByRole("heading", { name: "How the census reads statements" })).toBeVisible();
    await expect(how.getByRole("link", { name: /The census code/ })).toHaveAttribute(
      "href",
      "https://github.com/simonvanlierde/credit-matrix/tree/main/census",
    );
    await expect(how.getByRole("link", { name: /The model card/ })).toHaveAttribute(
      "href",
      "https://github.com/simonvanlierde/credit-matrix/blob/main/census/MODEL_CARD.md",
    );
  });

  test("scrolls inside its pane on a desktop, not as a page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/census");
    await expect(page.getByRole("img", { name: "Adoption over time" })).toBeVisible();
    const extra = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(extra).toBeLessThanOrEqual(2);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no detectable violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/census");
      await expect(page.getByRole("img", { name: "Adoption over time" })).toBeVisible();
      // Open the tables, so their contents are scanned too.
      for (const summary of await page.getByText("Show as a table").all()) await summary.click();
      expect((await scan(page)).violations).toEqual([]);
    });
  }

  test("has no detectable violations on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/census");
    await expect(page.getByRole("img", { name: "Adoption over time" })).toBeVisible();
    // Below sm the byline table gives way to one block per role, each place labelled.
    await expect(page.getByRole("region", { name: "Roles by place in the byline" })).toBeHidden();
    await expect(page.getByText("Middle authors").first()).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
