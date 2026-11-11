import { expect, type Locator, type Page, test } from "@playwright/test";
import { asReturningVisitor, settleMotion } from "./helpers";

/**
 * Contrast of the things axe cannot see: placeholder text, field boundaries,
 * and icon-only controls (WCAG 1.4.3 and 1.4.11). Colors are read as computed
 * and flattened over the ancestors' backgrounds through a canvas, so alpha and
 * any CSS color syntax resolve the way the browser paints them.
 */

type Rgb = [number, number, number];

/** Flatten `colors` (outermost first) onto white and return the ratio of the last two layers' result. */
function flatten(page: Page, layers: string[]): Promise<Rgb> {
  return page.evaluate((stack) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
    for (const color of stack) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
    }
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r ?? 0, g ?? 0, b ?? 0] as [number, number, number];
  }, layers);
}

const luminance = ([r, g, b]: Rgb) => {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Background colors from the root down to (and including) the element's own. */
const backdrop = (el: Locator, includeSelf: boolean) =>
  el.evaluate((node, self) => {
    const out: string[] = [];
    for (let n: Element | null = self ? node : node.parentElement; n; n = n.parentElement) {
      out.unshift(getComputedStyle(n).backgroundColor);
    }
    return out;
  }, includeSelf);

const style = (el: Locator, prop: string, pseudo?: string) =>
  el.evaluate(
    (node, [p, ps]) => getComputedStyle(node, ps || null).getPropertyValue(p as string),
    [prop, pseudo ?? ""],
  );

const themes = ["light", "dark"] as const;

for (const theme of themes) {
  test.describe(`visual contrast, ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await asReturningVisitor(page);
      await page.emulateMedia({ colorScheme: theme });
    });

    test("placeholders reach 4.5:1", async ({ page }) => {
      await page.goto("/");
      const fields = [page.locator("#work-title"), page.locator("#add-contributor")];
      await page.getByRole("button", { name: "Import" }).click();
      fields.push(page.locator("#import-text"), page.locator("#import-doi"));
      await settleMotion(page);
      for (const field of fields) {
        await expect(field).toBeVisible();
        const fg = await style(field, "color", "::placeholder");
        const bg = await flatten(page, await backdrop(field, true));
        const text = await flatten(page, [...(await backdrop(field, true)), fg]);
        expect(ratio(text, bg), `${await field.getAttribute("placeholder")}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test("field boundaries and the grip icon reach 3:1", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Load sample data" }).click();
      const grip = page.getByRole("button", { name: /^Reorder / }).first();
      const gripBg = await flatten(page, await backdrop(grip, true));
      const gripFg = await flatten(page, [...(await backdrop(grip, true)), await style(grip, "color")]);
      expect(ratio(gripFg, gripBg), "grip icon").toBeGreaterThanOrEqual(3);

      const edges = [page.locator("#work-title"), page.locator("#add-contributor")];
      await page.getByRole("button", { name: "Import" }).click();
      edges.push(page.locator("#import-text"), page.locator("#import-doi"));
      await settleMotion(page);
      for (const field of edges) {
        const own = await backdrop(field, true);
        const line = await flatten(page, [...own, await style(field, "border-bottom-color")]);
        const outside = await flatten(page, await backdrop(field, false));
        const inside = await flatten(page, own);
        const name = (await field.getAttribute("placeholder")) ?? "";
        expect(ratio(line, outside), `${name} vs outside`).toBeGreaterThanOrEqual(3);
        expect(ratio(line, inside), `${name} vs fill`).toBeGreaterThanOrEqual(3);
      }
    });

    test("primary actions and links follow the readable heatmap accent", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Load sample data" }).click();
      await page.getByRole("button", { name: "Heatmap options", exact: true }).click();
      await page.getByRole("button", { name: "Green", exact: true }).click();
      await page.keyboard.press("Escape");
      await settleMotion(page);
      const copy = page.getByRole("button", { name: "Copy statement", exact: true });
      const link = page.getByRole("link", { name: /^Plugins for/ });
      const accent = await page.evaluate(() => document.documentElement.style.getPropertyValue("--color-accent"));
      const fill = await flatten(page, [await style(copy, "background-color")]);
      expect(fill).toEqual(await flatten(page, [accent]));
      expect(await flatten(page, [await style(link, "color")])).toEqual(fill);
      const ink = await flatten(page, [await style(copy, "color")]);
      expect(ratio(ink, fill)).toBeGreaterThanOrEqual(4.5);
      await copy.hover();
      await settleMotion(page);
      expect(ratio(ink, await flatten(page, [await style(copy, "background-color")]))).toBeGreaterThanOrEqual(4.5);
    });

    test("heatmap color swatches have a visible boundary", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Load sample data" }).click();
      await page.getByRole("button", { name: "Heatmap options", exact: true }).click();
      await settleMotion(page);
      for (const name of ["Blue", "Red", "Green", "Purple", "Grayscale"]) {
        const swatch = page.getByRole("button", { name, exact: true });
        const own = await backdrop(swatch, true);
        const outside = await flatten(page, await backdrop(swatch, false));
        const fill = await flatten(page, own);
        const border = await flatten(page, [...own, await style(swatch, "border-top-color")]);
        expect(Math.max(ratio(fill, outside), ratio(border, outside)), name).toBeGreaterThanOrEqual(3);
      }
    });

    test("an empty grid cell's dot reaches 3:1 against the page", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Load sample data" }).click();
      const dot = page.locator("[data-empty-dot]").first();
      await expect(dot).toBeVisible();
      const ground = await backdrop(dot, false);
      const mark = await flatten(page, [...ground, await style(dot, "background-color")]);
      expect(ratio(mark, await flatten(page, ground))).toBeGreaterThanOrEqual(3);
    });

    test("the focus ring reaches 3:1 against the page", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Load sample data" }).click();
      const input = page.locator('input[aria-label="Name or ORCID iD"]').first();
      await input.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(input).toBeFocused();
      // The ring is the 2px layer of a stacked box-shadow, drawn outside the field over its parent's background.
      const ringColor = (await style(input, "box-shadow")).match(/(rgba?\([^)]*\)) 0px 0px 0px 2px/)?.[1];
      expect(ringColor, "box-shadow colour").toBeTruthy();
      const ground = await backdrop(input, false);
      const ring = await flatten(page, [...ground, ringColor as string]);
      expect(ratio(ring, await flatten(page, ground))).toBeGreaterThanOrEqual(3);
    });
  });
}

test("the contributor Name input shows a focus indicator", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  const input = page.locator('input[aria-label="Name or ORCID iD"]').first();
  await input.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  const shadow = await style(input, "box-shadow");
  expect(shadow, "a ring, not just a caret").toMatch(/0px 0px 0px 2px/);
});

test.describe("header at 200% zoom widths", () => {
  for (const width of [640, 700]) {
    test(`nothing overflows at ${width}px`, async ({ page }) => {
      await asReturningVisitor(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.getByRole("button", { name: "Load sample data" }).click();
      await settleMotion(page);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width);
      const box = await page.getByRole("button", { name: "Import" }).boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    });
  }
});

test("heatmap swatches and their selected outline survive forced colors", async ({ page }) => {
  await asReturningVisitor(page);
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("button", { name: "Heatmap options", exact: true }).click();
  const multicolor = page.getByRole("button", { name: "Per contributor", exact: true });
  await expect(multicolor).toHaveAttribute("aria-pressed", "true");
  expect(await style(multicolor, "background-image")).not.toBe("none");
  expect(Number.parseFloat(await style(multicolor, "outline-width"))).toBeGreaterThanOrEqual(2);
  const blue = page.getByRole("button", { name: "Blue", exact: true });
  expect(await flatten(page, [await style(blue, "background-color")])).toEqual([31, 78, 121]);
  await blue.click();
  expect(Number.parseFloat(await style(blue, "outline-width"))).toBeGreaterThanOrEqual(2);
  const custom = page.getByLabel("Custom", { exact: true });
  await custom.fill("#123456");
  await expect(blue).toHaveAttribute("aria-pressed", "false");
  expect(Number.parseFloat(await style(custom, "outline-width"))).toBeGreaterThanOrEqual(2);
});
