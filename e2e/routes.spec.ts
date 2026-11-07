import { expect, test } from "@playwright/test";

test("an unknown URL renders a working 404 without hydration errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/missing-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Return to CRediT Matrix" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Switch to (dark|light) mode$/ })).toBeVisible();
  expect(errors).toEqual([]);
});
