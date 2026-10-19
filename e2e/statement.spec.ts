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
  await expect(review.getByText("YL: no contributor — left out: Software")).toBeVisible();
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

test("in a Levels draft, the level and the contributor behind shared initials are chosen by keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#import-text").fill("Mark Green\nMaria Garcia\nEva Mills");
  await page.getByRole("button", { name: "Import data" }).click();
  await page.getByRole("radio", { name: "Levels" }).click();

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#import-text").fill("MG: conceptualization, writing – original draft. EM: software.");
  await page.getByRole("button", { name: "Review roles" }).click();
  const review = page.getByRole("region", { name: "Roles found in the statement" });
  await expect(review.getByText("1 role to add as Equal for 1 contributor.", { exact: false })).toBeVisible();

  // Both selects carry a name and open, move and choose from the keyboard alone.
  const level = review.getByRole("combobox", { name: "Level to assign" });
  const who = review.getByRole("combobox", { name: "MG" });
  await expect(who).toHaveText("Leave out");
  await level.focus();
  await page.keyboard.press("Enter");
  // The list opens on the current choice; wait for it before moving.
  await expect(page.getByRole("option", { name: "Equal" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("option", { name: "Lead" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(level).toHaveText("Lead");
  await expect(level).toBeFocused();
  await who.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Leave out" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("option", { name: "Maria Garcia" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(who).toHaveText("Maria Garcia");
  await expect(review.getByText("3 roles to add as Lead for 2 contributors.", { exact: false })).toBeVisible();
  await expect(review.getByRole("listitem").filter({ hasText: "Maria Garcia" }).first()).toContainText(
    "Conceptualization, Writing – original draft",
  );

  expect((await scan(page)).violations).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect((await scan(page)).violations).toEqual([]);

  await review.getByRole("button", { name: "Apply roles" }).click();
  await expect(page.getByRole("button", { name: "Conceptualization for Maria Garcia: Lead" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conceptualization for Mark Green: None" })).toBeVisible();
});
