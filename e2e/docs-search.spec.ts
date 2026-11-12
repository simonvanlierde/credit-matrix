import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

test("searches the guides and opens a result with the keyboard", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/docs");
  const search = page.getByRole("region", { name: "Search documentation" });
  const input = search.getByRole("combobox");
  await expect(input).toBeVisible({ timeout: 5000 });
  const shortcut = await input.getAttribute("aria-keyshortcuts");
  if (!shortcut) throw new Error("Missing search keyboard shortcut");
  await page.keyboard.press(shortcut);
  await expect(input).toBeFocused();
  await input.fill("Quarto");
  await expect(search.getByRole("option").first()).toContainText("CRediT statement for Quarto");
  await input.press("ArrowDown");
  const result = search.getByRole("option", { selected: true });
  const href = await result.getAttribute("href");
  expect(href).toMatch(/^\/docs\//);
  if (!href) throw new Error("Missing search result URL");
  const url = new URL(href, page.url()).href;
  await input.press("Enter");
  await expect(page).toHaveURL(url);
  await expect(page.locator("article")).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`${theme} phone search fits and exposes accessible results`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await asReturningVisitor(page);
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await page.goto("/docs/quarto");
    const search = page.getByRole("region", { name: "Search documentation" });
    await search.getByRole("combobox").fill("heatmap");
    await expect(search.getByRole("option").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const axe = await new AxeBuilder({ page }).include(".docs-search").analyze();
    expect(axe.violations).toEqual([]);
    await search.getByRole("combobox").press("Escape");
    await expect(search.getByRole("option")).toHaveCount(0);
  });
}

test("keeps the guide readable if the search module cannot load", async ({ page }) => {
  await asReturningVisitor(page);
  await page.route("**/pagefind/pagefind-component-ui.js", (route) => route.abort());
  await page.goto("/docs/quarto");
  await expect(page.getByRole("region", { name: "Search documentation" }).getByRole("alert")).toContainText(
    "Search could not load.",
  );
  await expect(page.locator("article")).toContainText("Quarto");
});

test("changes search chrome language while keeping the English index", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/docs");
  await page.getByRole("region", { name: "Search documentation" }).getByRole("combobox").fill("Quarto");
  await expect(page.getByRole("option").first()).toContainText("CRediT statement for Quarto");
  await page.getByRole("button", { name: "Language settings" }).click();
  await page.getByRole("combobox", { name: "Interface language", exact: true }).click();
  await page.getByRole("option", { name: "Nederlands", exact: true }).click();
  await page.keyboard.press("Escape");
  const search = page.getByRole("region", { name: "Documentatie doorzoeken" });
  const input = search.getByRole("combobox");
  await expect(input).toHaveAccessibleName(/\S/);
  await expect(input).not.toHaveAttribute("aria-label", "Search");
  await input.fill("Typst");
  await expect(search.getByRole("option").first()).toContainText("CRediT statement for Typst");
});
