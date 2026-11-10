import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 412, height: 823 } });

test("opening the welcome card on a first visit does not shift the page behind it", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { shift: number };
    w.shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) w.shift += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  // Layout shifts are reported a frame late.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { shift: number }).shift)).toBeLessThan(0.01);
});
