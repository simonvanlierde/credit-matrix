// biome-ignore lint/correctness/noNodejsModules: Playwright reads the browser's downloaded files.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createAuthor } from "../src/core/parse-authors";
import { DEFAULT_HEATMAP_SETTINGS } from "../src/lib/heatmap-settings";
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
  await expect(image).toBeVisible({ timeout: 15_000 });
  const source = await image.getAttribute("src");
  const svg = decodeURIComponent(source?.split(",").slice(1).join(",") ?? "");
  expect(svg).not.toContain("<circle ");
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
  await expect(
    page.getByText(`SVG · PDF · PNG ${png.readUInt32BE(16)} × ${png.readUInt32BE(20)} px · 300 dpi`),
  ).toBeVisible();
  await expect(preview).toHaveAttribute("tabindex", "0");
  await preview.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Heatmap", exact: true })).toBeFocused();
});

test("saves figure styling independently from the editable contribution grid", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const cells = page.locator("[data-cell]");
  const assignments = await cells.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Legend", exact: true }).click();
  await page.getByRole("option", { name: "Hidden", exact: true }).click();
  await page.getByRole("switch", { name: "Show contribution marks", exact: true }).click();
  await page.getByRole("button", { name: "Grayscale", exact: true }).click();
  await page.getByText("Advanced", { exact: true }).click();
  await page.getByRole("combobox", { name: "Font", exact: true }).click();
  await page.getByRole("option", { name: "Serif", exact: true }).click();
  await page.getByRole("combobox", { name: "Cell shape", exact: true }).click();
  await page.getByRole("option", { name: "Circle", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Font size (px)", exact: true }).fill("14");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  expect(await cells.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))).toEqual(assignments);
  await page.reload();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  const image = page.getByRole("region", { name: "Contribution heatmap" }).getByRole("img");
  const svg = decodeURIComponent((await image.getAttribute("src"))?.split(",").slice(1).join(",") ?? "");
  expect(svg).toContain("Noto Serif");
  expect(svg).toContain('fill="#404040"');
  expect(svg).toContain('rx="11"');
  expect(svg).not.toContain(">Lead<");
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Legend", exact: true })).toHaveText("Hidden");
  await expect(page.getByRole("switch", { name: "Show contribution marks", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Reset defaults", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Legend", exact: true })).toHaveText("Automatic");
  await expect(page.getByRole("switch", { name: "Show contribution marks", exact: true })).not.toBeChecked();
  await expect(page.getByRole("spinbutton", { name: "Width (mm)", exact: true })).toHaveValue("85");
});

test("changes legend placement and opts into marks in the actual export", async ({ page }) => {
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  const image = page.getByRole("region", { name: "Contribution heatmap" }).getByRole("img");
  const source = async () => decodeURIComponent((await image.getAttribute("src"))?.split(",").slice(1).join(",") ?? "");
  const figures: string[] = [];
  for (const name of ["Right", "Below"]) {
    await page.getByRole("combobox", { name: "Legend", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
    figures.push(await source());
  }
  expect(figures[0]).not.toBe(figures[1]);
  expect(figures[1]).not.toContain("<circle ");
  await page.getByRole("switch", { name: "Show contribution marks", exact: true }).click();
  const marked = await source();
  expect(marked).toContain("<circle ");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG", exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) throw new Error("Expected SVG download");
  expect(await readFile(path, "utf8")).toBe(marked);
});

test("clears copied-image status when the figure or PNG dimensions change", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: async (items: ClipboardItem[]) => Promise.all(items.map((item) => item.getType("image/png"))) },
    });
  });
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  const copy = page.getByRole("button", { name: "Copy PNG", exact: true });
  const copied = page.getByRole("button", { name: "Copied", exact: true });
  await copy.click();
  await expect(copied).toBeVisible();
  await page.getByRole("button", { name: "Grayscale", exact: true }).click();
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(copied).toBeVisible();
  await page.getByRole("spinbutton", { name: "Width (mm)", exact: true }).fill("100");
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(copied).toBeVisible();
  await page.getByRole("combobox", { name: "Resolution", exact: true }).click();
  await page.getByRole("option", { name: "600 dpi", exact: true }).click();
  await expect(copy).toBeVisible();
});

test("waits for a changed recipe's clipboard write before showing copied", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () =>
        new Promise<void>((resolve) =>
          document.addEventListener("finish-recipe-copy", () => resolve(), { once: true }),
        ),
    });
  });
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  await page.getByText("Export recipe", { exact: true }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  const copy = page.getByRole("button", { name: "Copy export recipe", exact: true });
  const copied = page.getByRole("button", { name: "Copied", exact: true });
  await copy.click();
  await page.evaluate(() => document.dispatchEvent(new Event("finish-recipe-copy")));
  await expect(copied).toBeVisible();
  await page.getByRole("combobox", { name: "Use in", exact: true }).click();
  await page.getByRole("option", { name: "Sphinx", exact: true }).click();
  await copy.click();
  await expect(copy).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("finish-recipe-copy")));
  await expect(copied).toBeVisible();
});

test("writes requested PNG width and print resolution into the downloaded file", async ({ page }) => {
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Width (mm)", exact: true }).fill("100");
  await page.getByRole("combobox", { name: "Resolution", exact: true }).click();
  await page.getByRole("option", { name: "600 dpi", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) throw new Error("Expected PNG download");
  const png = await readFile(path);
  expect(png.readUInt32BE(16)).toBe(Math.round((100 / 25.4) * 600));
  const densities: number[] = [];
  for (let offset = 8; offset < png.length; ) {
    if (png.toString("ascii", offset + 4, offset + 8) === "pHYs") densities.push(png.readUInt32BE(offset + 8));
    offset += 12 + png.readUInt32BE(offset);
  }
  expect(densities).toEqual([23622]);
  expect(png.toString("utf8")).toContain("Description");
});

test("offers SVG when a tall team's requested PNG exceeds canvas limits", async ({ page }) => {
  await seedStorage(
    page,
    {
      welcomeSeen: true,
      activeDraftId: "tall-team",
      drafts: {
        "tall-team": {
          authors: Array.from({ length: 200 }, (_, i) =>
            createAuthor(`Researcher ${i + 1}`, { contributions: [{ role: "Software", score: 100 }] }),
          ),
          heatmapSettings: { ...DEFAULT_HEATMAP_SETTINGS, horizontal: true, pngWidthMm: 300, pngDpi: 600 },
        },
      },
    },
    { clearFirst: true },
  );
  await page.reload();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download PNG", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download SVG", exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText(/This PNG would be too large/)).toBeVisible();
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
  expect(svg).toMatch(/<text x="[^"]+"[^>]*><tspan[^>]*>AL<\/tspan><\/text>/);
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
  await expect(image).toBeVisible({ timeout: 15_000 });
  const width = () => image.evaluate((img) => img.getBoundingClientRect().width);
  await expect(page.getByText(/Labels would print at about/)).toBeVisible();
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

const mixedNames = ["Alexandra Montgomery Rivera 1", "Li"];
const headerScenarios = [
  { name: "large wide-glyph", names: ["É".repeat(20), "W".repeat(20)], fontSize: 32, size: 8, horizontal: false },
  ...[10.5, 32].flatMap((fontSize) => [
    { name: `mixed-length ${fontSize}px`, names: mixedNames, fontSize, size: 22, horizontal: false },
    {
      name: `reversed mixed-length ${fontSize}px`,
      names: [...mixedNames].reverse(),
      fontSize,
      size: 22,
      horizontal: false,
    },
    { name: `transposed mixed-length ${fontSize}px`, names: mixedNames, fontSize, size: 22, horizontal: true },
  ]),
];

for (const scenario of headerScenarios) {
  test(`keeps ${scenario.name} rotated labels inside the exported canvas`, async ({ page, context }) => {
    await seedStorage(
      page,
      {
        welcomeSeen: true,
        activeDraftId: "large-type",
        drafts: {
          "large-type": {
            authors: scenario.names.map((name) =>
              createAuthor(name, {
                contributions: [
                  { role: "Project administration", score: 100 },
                  { role: "Software", score: 100 },
                ],
              }),
            ),
            heatmapSettings: {
              ...DEFAULT_HEATMAP_SETTINGS,
              fontSize: scenario.fontSize,
              size: scenario.size,
              horizontal: scenario.horizontal,
              legend: false,
            },
          },
        },
      },
      { clearFirst: true },
    );
    await page.reload();
    await page.getByRole("button", { name: "Heatmap", exact: true }).click();
    const source = await page
      .getByRole("region", { name: "Contribution heatmap" })
      .getByRole("img")
      .getAttribute("src");
    const svg = decodeURIComponent(source?.split(",").slice(1).join(",") ?? "");
    const figure = await context.newPage();
    try {
      await figure.setContent(svg);
      const bounds = await figure.evaluate(async () => {
        await document.fonts.ready;
        const canvas = document.querySelector("svg");
        if (!canvas) throw new Error("Expected SVG");
        const view = canvas.viewBox.baseVal;
        const labels = Array.from(canvas.querySelectorAll("text"));
        const fits = labels.every((label) => {
          const box = label.getBBox();
          const matrix = label.getCTM();
          if (!matrix) throw new Error("Expected text transform");
          return [
            [box.x, box.y],
            [box.x + box.width, box.y],
            [box.x, box.y + box.height],
            [box.x + box.width, box.y + box.height],
          ].every(([x, y]) => {
            const point = new DOMPoint(x, y).matrixTransform(matrix);
            return point.x >= 0 && point.y >= 0 && point.x <= view.width && point.y <= view.height;
          });
        });
        const top = labels.filter((label) => label.hasAttribute("transform"));
        const first = top[0]?.getCTM();
        const second = top[1]?.getCTM();
        if (!(first && second)) throw new Error("Expected two column labels");
        const separation = Math.abs((second.e - first.e) * -first.b + (second.f - first.f) * first.a);
        return { fits, separation, height: Math.max(...top.map((label) => label.getBBox().height)) };
      });
      expect(bounds.fits).toBe(true);
      expect(bounds.separation).toBeGreaterThan(bounds.height);
    } finally {
      await figure.close();
    }
  });
}

test.describe("touch-screen previews", () => {
  test.use({ hasTouch: true });
  for (const theme of ["light", "dark"] as const) {
    test(`the ${theme} phone preview fits the viewport and has no detectable accessibility violations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.getByText(/Select to cycle/)).toBeHidden();
      await page.getByRole("button", { name: "Heatmap", exact: true }).click();
      const preview = page.getByRole("region", { name: "Contribution heatmap" });
      await expect(preview.getByRole("img")).toBeVisible({ timeout: 15_000 });
      const panel = page.getByRole("dialog", { name: "Heatmap", exact: true });
      const bounds = await panel.boundingBox();
      if (!bounds) throw new Error("Expected heatmap panel");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
      expect((await scan(page)).violations).toEqual([]);
      await page.getByRole("button", { name: "Figure settings", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Orientation", exact: true })).toBeInViewport();
      expect((await scan(page)).violations).toEqual([]);
      await page.getByRole("button", { name: "Figure settings", exact: true }).click();
      await expect(preview.getByRole("img")).toBeVisible({ timeout: 15_000 });
    });
  }
});

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

for (const width of [1440, 320]) {
  test(`copies current figure recipes and keeps a manual fallback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: (text: string) => {
          if (sessionStorage.getItem("refuseRecipeCopy")) return Promise.reject(new Error("Clipboard denied"));
          sessionStorage.setItem("copiedRecipe", text);
          return Promise.resolve();
        },
      });
    });
    await page.getByRole("button", { name: "Heatmap", exact: true }).click();
    await page.getByRole("button", { name: "Figure settings", exact: true }).click();
    await page.getByRole("button", { name: "Grayscale", exact: true }).click();
    await page.getByText("Export recipe", { exact: true }).click();
    const recipe = page.getByRole("textbox", { name: "Export recipe", exact: true });
    await expect(recipe).toBeVisible();
    expect(await recipe.inputValue()).toContain("--color '#404040'");
    await page.getByRole("button", { name: "Copy export recipe", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("copiedRecipe"))).toBe(await recipe.inputValue());
    await page.getByRole("combobox", { name: "Use in", exact: true }).click();
    await page.getByRole("option", { name: "MyST / Jupyter Book", exact: true }).click();
    await expect(recipe).toHaveValue(/:::\{credit-heatmap\}/);
    await expect(page.getByText("MyST uses the page’s author roles", { exact: false })).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem("refuseRecipeCopy", "true"));
    await page.getByRole("button", { name: "Copy export recipe", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy failed", exact: true })).toBeVisible();
    await expect(recipe).toHaveValue(/:color: #404040/);
    const bounds = await recipe.boundingBox();
    if (!bounds) throw new Error("Recipe field not visible");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect((await scan(page)).violations).toEqual([]);
  });
}

test("reports the smallest exported text at final print size, including the legend", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Width (mm)", exact: true }).fill("40");
  await page.keyboard.press("Tab");
  const source = await page.getByRole("region", { name: "Contribution heatmap" }).getByRole("img").getAttribute("src");
  const svg = decodeURIComponent(source?.split(",").slice(1).join(",") ?? "");
  const points = await page.evaluate((text) => {
    const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    const sizes = [...root.querySelectorAll("text")].map((node) => Number(node.getAttribute("font-size")));
    return (Math.min(...sizes) * 40 * 72) / (Number(root.getAttribute("width")) * 25.4);
  }, svg);
  await expect(
    page.getByText(
      `Labels would print at about ${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(points)} pt. Increase the width or transpose the figure for readable print.`,
      { exact: true },
    ),
  ).toBeVisible();
});
