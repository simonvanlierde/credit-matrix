import { expect, test } from "@playwright/test";
import { seedStorage } from "./helpers";

test.use({ viewport: { width: 412, height: 823 } });

/** Records whether the first-run card was ever on screen, from the first frame on. */
function watchCard(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
    const w = window as unknown as { cardSeen: boolean };
    w.cardSeen = false;
    const look = () => {
      const card = document.getElementById("getting-started");
      if (card && getComputedStyle(card).display !== "none") w.cardSeen = true;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const cardSeen = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { cardSeen: boolean }).cardSeen);

test("a first visit has the welcome card in the HTML, before any script runs", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 412, height: 823 } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("dialog#getting-started")).toBeVisible();
  await expect(page.getByText("Draft a manuscript-ready contribution statement")).toBeVisible();
  await context.close();
});

test("a first visit ends with the card as a real modal, with no hydration warnings", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/hydrat/i.test(message.text())) problems.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator("dialog#getting-started")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.querySelector("dialog#getting-started")?.matches(":modal")))
    .toBe(true);
  await expect(page.locator("dialog#getting-started")).not.toHaveAttribute("data-first-run");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog#getting-started")).toBeHidden();
  expect(problems).toEqual([]);
});

test("a returning visitor never sees the card paint", async ({ page }) => {
  await seedStorage(page, { authors: [], welcomeSeen: true });
  await watchCard(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "About this app" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await cardSeen(page)).toBe(false);
});

test("a share link does not paint the card either", async ({ page }) => {
  await watchCard(page);
  await page.goto("/#s=x");
  await page.waitForTimeout(800);
  expect(await cardSeen(page)).toBe(false);
});
