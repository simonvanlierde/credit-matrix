// biome-ignore-all lint/correctness/noNodejsModules: browser fixtures run in Node.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

declare const chrome: {
  tabs: {
    query: (query: { active: boolean }) => Promise<{ id: number }[]>;
    setZoom: (id: number, factor: number) => Promise<void>;
    getZoom: (id: number) => Promise<number>;
  };
};

for (const colorScheme of ["light", "dark"] as const) {
  test(`real 200% browser zoom keeps controls and figure exports usable (${colorScheme})`, async ({
    browserName,
    baseURL,
  }) => {
    test.skip(browserName !== "chromium", "Uses Chromium's browser zoom API, not viewport or pinch-zoom emulation.");
    const dir = await mkdtemp(join(tmpdir(), "credit-browser-zoom-"));
    let context: BrowserContext | undefined;
    try {
      const extension = join(dir, "extension");
      await mkdir(extension);
      await writeFile(
        join(extension, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Browser zoom check",
          version: "1.0",
          background: { service_worker: "background.js" },
        }),
      );
      await writeFile(join(extension, "background.js"), "chrome.runtime.onInstalled.addListener(() => {});");
      context = await chromium.launchPersistentContext(join(dir, "profile"), {
        channel: "chromium",
        headless: true,
        viewport: null,
        deviceScaleFactor: undefined,
        colorScheme,
        serviceWorkers: "block",
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--window-size=1440,1000"],
      });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      const page = context.pages()[0] ?? (await context.newPage());
      await asReturningVisitor(page);
      await page.goto(`${baseURL}/`);
      await page.getByRole("button", { name: "Load sample data" }).click();
      const before = await page.evaluate(() => ({ width: innerWidth, density: devicePixelRatio }));
      const zoom = await worker.evaluate(async () => {
        // Browser zoom changes layout and text size; changing only the viewport would miss this.
        const [tab] = await chrome.tabs.query({ active: true });
        if (!tab) throw new Error("No active browser tab");
        await chrome.tabs.setZoom(tab.id, 2);
        return chrome.tabs.getZoom(tab.id);
      });
      expect(zoom).toBe(2);
      await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(before.density * 2);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(before.width / 2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(before.width / 2);
      await expect(page.getByRole("button", { name: "Import", exact: true })).toBeInViewport();
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Import contributors", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      const heatmap = page.getByRole("button", { name: "Heatmap", exact: true });
      await heatmap.click();
      const panel = page.getByRole("dialog", { name: "Heatmap", exact: true });
      await panel.getByRole("button", { name: "Figure settings", exact: true }).click();
      const custom = panel.getByLabel("Custom", { exact: true });
      await custom.focus();
      await expect(custom).toBeInViewport();
      await expect(custom).toBeFocused();
      const download = panel.getByRole("button", { name: "Download SVG", exact: true });
      await expect(download).toBeEnabled();
      await download.focus();
      await expect(download).toBeInViewport();
      const file = page.waitForEvent("download");
      await page.keyboard.press("Enter");
      expect((await file).suggestedFilename()).toBe("credit-heatmap.svg");
      await page.keyboard.press("Escape");
      await expect(heatmap).toBeFocused();
      for (const path of ["/about", "/census", "/accessibility"]) {
        await page.goto(`${baseURL}${path}`);
        await expect(
          page.getByRole("banner").getByRole("button", { name: /^Switch to (dark|light) mode$/ }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(before.width / 2);
      }
    } finally {
      await context?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
