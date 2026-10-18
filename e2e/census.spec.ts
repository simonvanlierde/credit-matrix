import { expect, test } from "@playwright/test";
import data from "../public/data/census.json";
import { asReturningVisitor, scan } from "./helpers";

test.describe("CRediT census page", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("is linked from About and shows the counts with their provenance", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "About this app" }).click();
    await page.getByRole("link", { name: /CRediT census/ }).click();
    await expect(page).toHaveURL(/\/census\/?$/);

    await expect(page.getByRole("heading", { name: "CRediT census", exact: true })).toBeVisible();
    await expect(page.getByText("Preliminary figures")).toBeVisible();
    await expect(page.getByText(/F1 score of 0\.877/)).toBeVisible();
    await expect(page.getByText(data.snapshot, { exact: true })).toBeVisible();
    await expect(page.getByText(data.dataset_version, { exact: true })).toBeVisible();
    await expect(page.getByText(data.openalex_sources ?? "", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Adoption over time" })).toBeVisible();
    // Role names come from the CRediT catalog, not the census slugs.
    await expect(page.getByRole("rowheader", { name: "Writing – review & editing" })).toBeVisible();
    await expect(page.getByText(data.publishers[0]?.publisher ?? "")).toBeVisible();
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
    expect((await scan(page)).violations).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
