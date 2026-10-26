import { expect, type Locator, type Page, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function loadSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
}

test.describe("behaviours that must not trap or hide", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("the bulk-assign Undo bar outlasts 8 seconds (2.2.1)", async ({ page }) => {
    await page.clock.install();
    await loadSample(page);
    await page.getByRole("button", { name: "Bulk assign" }).click();
    await page.getByRole("button", { name: "Assign every role", exact: true }).click();
    const bar = page.getByRole("group", { name: "Bulk change applied." }).getByRole("button");
    await expect(bar).toBeVisible();
    await page.clock.runFor(20_000);
    await expect(bar).toBeVisible();
    await page.clock.runFor(45_000);
    await expect(bar).toBeHidden();
  });

  test("shift-tabbing up the phone role list never lands under the sticky picker (2.4.11)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadSample(page);
    const list = page.getByRole("list", { name: /^Roles for / });
    const picker = page.locator("#mobile-contributor").locator("xpath=..");
    await list.getByRole("button").last().focus();
    let stops = 0;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Shift+Tab");
      const inList = await page.evaluate(() => !!document.activeElement?.closest("ul[aria-label^='Roles for']"));
      if (!inList) break;
      // Let the focus scroll settle.
      await page.waitForTimeout(50);
      const focused = await box(page.locator(":focus"));
      const sticky = await box(picker);
      expect(overlaps(focused, sticky), `stop ${i} at y=${focused.y}`).toBe(false);
      expect(focused.y, `stop ${i} under the header`).toBeGreaterThanOrEqual(52);
      stops++;
    }
    expect(stops).toBeGreaterThan(20);
  });

  test("an error banner does not sit over the focused element (2.4.11)", async ({ page }) => {
    await loadSample(page);
    await page.goto("/#s=definitely-not-a-payload");
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    await expect(dismiss).toBeVisible();
    const banner = dismiss.locator("xpath=..");
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(30);
      const focused = page.locator(":focus");
      if (await focused.evaluate((el) => el === document.body)) continue;
      if (await banner.evaluate((el, f) => el.contains(f), await focused.elementHandle())) continue;
      expect(overlaps(await box(focused), await box(banner)), `tab stop ${i}`).toBe(false);
    }
  });

  test("a modal closes on release over the backdrop, not on press (2.5.2)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.locator("dialog[open]");
    await page.locator("#import-text").fill("Jane Smith");
    await page.mouse.move(5, 300);
    await page.mouse.down();
    await expect(dialog).toBeVisible();
    await expect(page.locator("#import-text")).toHaveValue("Jane Smith");
    await page.mouse.up();
    await expect(dialog).toBeHidden();
  });

  test("a press inside the modal released on the backdrop keeps it open (2.5.2)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.locator("dialog[open]");
    const field = await box(page.locator("#import-text"));
    await page.mouse.move(field.x + 10, field.y + 10);
    await page.mouse.down();
    await page.mouse.move(5, 300);
    await page.mouse.up();
    await expect(dialog).toBeVisible();
  });

  test("Escape dismisses the census chart readout while the pointer rests on it (1.4.13)", async ({ page }) => {
    await page.goto("/census");
    const chart = page.getByRole("img", { name: "Adoption over time" });
    await chart.scrollIntoViewIfNeeded();
    const rect = await box(chart);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.move(rect.x + rect.width / 2 + 3, rect.y + rect.height / 2);
    const readout = chart.locator("xpath=..").locator("div[aria-hidden=true]");
    await expect(readout).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(readout).toBeHidden();
  });
});
