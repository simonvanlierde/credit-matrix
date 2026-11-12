import { expect, test } from "@playwright/test";
import { asReturningVisitor, scan } from "./helpers";

test.beforeEach(async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
});

for (const failure of ["decode", "context", "encode"] as const) {
  test(`recovers from PNG ${failure} failure and keeps SVG available`, async ({ page }) => {
    await page.evaluate((stage) => {
      if (stage === "decode") {
        const original = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = () => {
          HTMLImageElement.prototype.decode = original;
          return Promise.reject(new Error("Image decoding failed"));
        };
      } else if (stage === "context") {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = () => {
          HTMLCanvasElement.prototype.getContext = original;
          return null;
        };
      } else {
        const original = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = (callback) => {
          HTMLCanvasElement.prototype.toBlob = original;
          callback(null);
        };
      }
    }, failure);
    const png = page.getByRole("button", { name: "Download PNG", exact: true });
    await png.click();
    const alert = page.getByRole("dialog", { name: "Heatmap", exact: true }).getByRole("alert");
    await expect(alert).toContainText("PNG");
    await expect(png).toBeEnabled();
    const svgDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download SVG", exact: true }).click();
    expect((await svgDownload).suggestedFilename()).toBe("credit-heatmap.svg");
    const pngDownload = page.waitForEvent("download");
    await png.click();
    expect((await pngDownload).suggestedFilename()).toBe("credit-heatmap.png");
    await expect(alert).toHaveCount(0);
  });
}

test("reports rejected image clipboard writes and allows retry", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          await Promise.all(items.map((item) => item.getType("image/png")));
          throw new DOMException("Clipboard access denied", "NotAllowedError");
        },
      },
    });
  });
  await page.getByRole("button", { name: "Copy PNG", exact: true }).click();
  const failed = page.getByRole("button", { name: /Copy failed/i });
  await expect(failed).toBeEnabled();
  await page.evaluate(() => {
    navigator.clipboard.write = async (items: ClipboardItem[]) => {
      await Promise.all(items.map((item) => item.getType("image/png")));
    };
  });
  await failed.click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeEnabled();
});

for (const mode of ["forced colors", "reduced motion"] as const) {
  test(`keeps heatmap settings accessible with ${mode}`, async ({ page }) => {
    await page.emulateMedia(mode === "forced colors" ? { forcedColors: "active" } : { reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Figure settings", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Legend", exact: true })).toBeVisible();
    // Preview rendering enables the exports asynchronously; scan their settled state.
    await expect(page.getByRole("button", { name: "Download PNG", exact: true })).toBeEnabled();
    expect((await scan(page)).violations).toEqual([]);
    await page.getByRole("combobox", { name: "Legend", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Right", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "Legend", exact: true })).toBeFocused();
  });
}

test.describe("short zoom-sized viewport", () => {
  test.use({ viewport: { width: 320, height: 180 } });
  test("keeps settings and downloads reachable", async ({ page }) => {
    await page.getByRole("button", { name: "Figure settings", exact: true }).click();
    const legend = page.getByRole("combobox", { name: "Legend", exact: true });
    await legend.click({ timeout: 5000 });
    await page.getByRole("option", { name: "Right", exact: true }).click();
    await expect(legend).toHaveText("Right");
    await page.getByText("Advanced", { exact: true }).click();
    const fontSize = page.getByRole("spinbutton", { name: "Font size (px)", exact: true });
    await fontSize.fill("14");
    await page.keyboard.press("Tab");
    await expect(fontSize).toHaveValue("14");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download SVG", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("credit-heatmap.svg");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
