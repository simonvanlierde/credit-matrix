// biome-ignore lint/correctness/noNodejsModules: Playwright reads the browser's downloaded files.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createAuthor } from "../src/core/parse-authors";
import { asReturningVisitor, scan, seedStorage, settleMotion } from "./helpers";

test.beforeEach(async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await settleMotion(page);
});

test("previews the exact SVG and reports the downloaded PNG dimensions", async ({ page }) => {
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  const preview = page.getByRole("region", { name: "Contribution heatmap" });
  const image = preview.getByRole("img");
  await expect(image).toBeVisible();
  const source = await image.getAttribute("src");
  const svg = decodeURIComponent(source?.split(",").slice(1).join(",") ?? "");
  expect(svg).toContain("<circle ");
  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG", exact: true }).click();
  const svgPath = await (await svgDownload).path();
  if (!svgPath) throw new Error("Expected SVG download");
  expect(await readFile(svgPath, "utf8")).toBe(svg);

  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  const pngPath = await (await pngDownload).path();
  if (!pngPath) throw new Error("Expected PNG download");
  const png = await readFile(pngPath);
  await expect(page.getByText(`SVG · PNG ${png.readUInt32BE(16)} × ${png.readUInt32BE(20)} px`)).toBeVisible();
  await expect(preview).toHaveAttribute("tabindex", "0");
  await preview.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Heatmap", exact: true })).toBeFocused();
});

test("keeps the desktop key beside the table and reflects display changes in the preview", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const table = page.getByRole("table", { name: "Contributions" });
  const hint = page.getByText(/Select to cycle/);
  await expect(hint).toContainText("Arrow keys move");
  const tableBox = await table.boundingBox();
  const hintBox = await hint.boundingBox();
  if (!(tableBox && hintBox)) throw new Error("Expected table and key");
  expect(hintBox.y - tableBox.y - tableBox.height).toBeLessThan(80);

  await page.getByRole("button", { name: "Heatmap options", exact: true }).click();
  await page.getByText("Use initials", { exact: true }).click();
  await expect(page.getByRole("switch", { name: /Use initials/ })).toBeChecked();
  await page.getByRole("button", { name: "Transpose", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  const source = await page.getByRole("region", { name: "Contribution heatmap" }).getByRole("img").getAttribute("src");
  const svg = decodeURIComponent(source?.split(",").slice(1).join(",") ?? "");
  expect(svg).toContain(">AL<");
  expect(svg).toMatch(/<text x="[^"]+"[^>]*>AL<\/text>/);
});

test("lets a large team inspect the figure at actual size without stretching the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedStorage(
    page,
    {
      welcomeSeen: true,
      activeDraftId: "wide-team",
      drafts: {
        "wide-team": {
          authors: Array.from({ length: 100 }, (_, i) =>
            createAuthor(`Researcher ${i + 1}`, { contributions: [{ role: "Software", score: 100 }] }),
          ),
          inputMode: "levels",
        },
      },
    },
    { clearFirst: true },
  );
  await page.reload();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  const preview = page.getByRole("region", { name: "Contribution heatmap" });
  const image = preview.getByRole("img");
  await expect(image).toBeVisible();
  const width = () => image.evaluate((img) => img.getBoundingClientRect().width);
  expect(await width()).toBeLessThan(512);
  await page.getByRole("button", { name: "Actual size", exact: true }).click();
  expect(await width()).toBeGreaterThan(2000);
  expect(await preview.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await preview.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => preview.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Fit to width", exact: true }).click();
  expect(await width()).toBeLessThan(512);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

for (const theme of ["light", "dark"] as const) {
  test(`the ${theme} phone preview fits the viewport and has no detectable accessibility violations`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.getByText(/Select to cycle/)).toBeHidden();
    await page.getByRole("button", { name: "Heatmap", exact: true }).click();
    const preview = page.getByRole("region", { name: "Contribution heatmap" });
    await expect(preview.getByRole("img")).toBeVisible();
    const panel = page.getByRole("dialog", { name: "Heatmap", exact: true });
    const bounds = await panel.boundingBox();
    if (!bounds) throw new Error("Expected heatmap panel");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    expect((await scan(page)).violations).toEqual([]);
  });
}

test("keeps a damaged display preference from crashing the export panel", async ({ page }) => {
  await seedStorage(
    page,
    {
      welcomeSeen: true,
      activeDraftId: "damaged",
      drafts: {
        damaged: {
          authors: [createAuthor("Researcher Example", { contributions: [{ role: "Software", score: 100 }] })],
          heatmapMonoColor: "invalid",
        },
      },
    },
    { clearFirst: true },
  );
  await page.reload();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Heatmap", exact: true }).getByRole("alert")).toContainText(
    "Could not export the heatmap as SVG.",
  );
  await expect(page.getByRole("button", { name: "Download SVG", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Heatmap options", exact: true })).toBeVisible();
});
