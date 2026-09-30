import { expect, test } from "@playwright/test";
import { onScreen } from "./helpers";

test("deletes every draft after confirmation, and a reload finds none", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  await page.getByLabel("Draft title").fill("Paper one");
  await page.getByLabel("Draft title").press("Enter");
  await page.getByRole("button", { name: /^Drafts:/ }).click();
  await page.getByRole("button", { name: "New draft" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  await page.getByRole("button", { name: /^Drafts:/ }).click();
  await page.getByRole("button", { name: "Delete all drafts" }).click();
  await expect(onScreen(page, "Delete every draft in this browser? This cannot be undone.")).toBeVisible();
  // The confirm button's text, not the per-draft trash icons labelled the same.
  await page.getByText("Delete", { exact: true }).click();

  await page.reload();
  await page.getByRole("button", { name: /^Drafts:/ }).click();
  await expect(page.getByRole("button", { name: "Switch to Paper one" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
});

// Two pages in one context share localStorage, and a write in one fires a
// `storage` event in the other, as between two real tabs.
test("follows another tab's edit of the open draft and says so", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  await other
    .getByRole("button", { name: /^Remove / })
    .first()
    .click();
  await expect(other.getByRole("button", { name: /^Remove / })).toHaveCount(2);

  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2);
  await expect(onScreen(page, "This draft was updated in another tab.")).toBeVisible();
});
