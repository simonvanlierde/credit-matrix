import { expect, test } from "@playwright/test";
import { asReturningVisitor, onScreen, scan } from "./helpers";

test.beforeEach(async ({ page }) => {
  await asReturningVisitor(page);
});

test("a pasted statement fills the grid after review, and Undo takes it back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#import-text").fill("Mark Green\nEva Mills\nSimon L. Vos\nFrank Gray");
  await page.getByRole("button", { name: "Import data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(4);

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .locator("#import-text")
    .fill(
      "MG: Writing – original draft, conceptualization. EM, SLV and FG: data curation and visualization. " +
        "YL: software. All authors approved the final manuscript.",
    );
  await expect(page.getByText("Detected: CRediT statement")).toBeVisible();
  await page.getByRole("button", { name: "Review roles" }).click();

  const review = page.getByRole("region", { name: "Roles found in the statement" });
  await expect(review).toBeVisible();
  await expect(review.getByRole("heading")).toBeFocused();
  await expect(review.getByText("Not matched: YL")).toBeVisible();
  await expect(review.getByRole("listitem").filter({ hasText: "Mark Green" })).toContainText(
    "Conceptualization, Writing – original draft",
  );
  // Nothing is written until Apply.
  await expect(page.getByRole("button", { name: /^Conceptualization for Mark Green:/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect((await scan(page)).violations).toEqual([]);

  await review.getByRole("button", { name: "Apply roles" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(onScreen(page, "8 roles added from the statement.")).toBeVisible();
  for (const name of ["Eva Mills", "Simon L. Vos", "Frank Gray"]) {
    await expect(page.getByRole("button", { name: `Visualization for ${name}: Contributed` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
  const markConcept = page.getByRole("button", { name: /^Conceptualization for Mark Green:/ });
  await expect(markConcept).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(markConcept).toHaveAttribute("aria-pressed", "false");
});
