import { expect, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

test.use({ serviceWorkers: "block" });

for (const theme of ["light", "dark"] as const) {
  test(`navigation paints the saved accent before app scripts load (${theme})`, async ({ page }) => {
    await asReturningVisitor(page);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await page.getByRole("button", { name: "Heatmap options", exact: true }).click();
    await page.getByRole("button", { name: "Green", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("style", /--color-theme: #21763c/);
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim(),
    );
    const mark = await page
      .locator("header svg rect")
      .first()
      .evaluate((cell) => getComputedStyle(cell).fill);
    await page.route("**/assets/*.js", (route) => route.abort());
    await page.getByRole("link", { name: "CRediT census", exact: true }).click();
    for (const path of ["/census", "/about", "/accessibility", "/"]) {
      if (path !== "/census") await page.goto(path);
      await expect
        .poll(() =>
          page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim()),
        )
        .toBe(accent);
      await expect
        .poll(() =>
          page
            .locator("header svg rect")
            .first()
            .evaluate((cell) => getComputedStyle(cell).fill),
        )
        .toBe(mark);
    }

    await page.unroute("**/assets/*.js");
    await page.route("**/assets/*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await page.addInitScript(() => {
      const w = window as unknown as { themeFrames: string[][] };
      w.themeFrames = [];
      const sample = () => {
        const cell = document.querySelector("header svg rect");
        const color = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim();
        if (cell && color) w.themeFrames.push([color, getComputedStyle(cell).fill]);
        if (w.themeFrames.length < 120) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.reload();
    await expect(page.locator("#add-contributor")).toBeEditable();
    const frames = await page.evaluate(() => (window as unknown as { themeFrames: string[][] }).themeFrames);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.every(([color, fill]) => color === accent && fill === mark)).toBe(true);
  });
}
