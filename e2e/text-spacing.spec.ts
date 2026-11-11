import { expect, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

test.use({ serviceWorkers: "block" });

for (const width of [320, 375, 768, 1440]) {
  test(`text spacing keeps pages and figure settings usable at ${width}px`, async ({ page }) => {
    await asReturningVisitor(page);
    await page.setViewportSize({ width, height: 900 });
    const spacing =
      "* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }";
    for (const path of ["/about", "/census", "/accessibility", "/"]) {
      await page.goto(path);
      await expect(
        page.getByRole("banner").getByRole("button", { name: /^Switch to (dark|light) mode$/ }),
      ).toBeVisible();
      await page.addStyleTag({ content: spacing });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.getByRole("button", { name: "Load sample data" }).click();
    const trigger = page.getByRole("button", { name: "Heatmap", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Heatmap", exact: true });
    await dialog.getByRole("button", { name: "Figure settings", exact: true }).click();
    await expect(dialog.getByLabel("Custom")).toBeVisible();
    const download = dialog.getByRole("button", { name: "Download PNG", exact: true });
    await expect(download).toBeEnabled();
    await download.focus();
    await expect(download).toBeInViewport();
    const box = await download.boundingBox();
    if (!box) throw new Error("Download button has no box");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
}
