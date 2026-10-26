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

/** The first inset ring's color out of a computed box-shadow. */
const ringColor = (el: Locator) =>
  el.evaluate((node) => {
    const shadow = getComputedStyle(node).boxShadow;
    for (const m of shadow.matchAll(/((?:rgb|oklch|lab|oklab|hsl|color)a?\([^)]*\))\s+([^,]*)/g)) {
      if (m[2]?.includes("inset") && !/\b0px\s*$/.test(m[2].trim())) return m[1] as string;
    }
    return "";
  });

const themes = ["light", "dark"] as const;

for (const theme of themes) {
  test.describe(`visual contrast, ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await asReturningVisitor(page);
      await page.emulateMedia({ colorScheme: theme });
    });

    test("placeholders reach 4.5:1", async ({ page }) => {
      await page.goto("/");
      const fields = [page.locator("#work-title"), page.getByPlaceholder(/Add names/)];
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

      const edges = [page.locator("#work-title"), page.getByPlaceholder(/Add names/)];
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

    test("an empty grid cell's ring reaches 3:1 against its fill and the card", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Load sample data" }).click();
      const cell = page.locator(".contribution-cell.ring-inset").first();
      await expect(cell).toBeVisible();
      const own = await backdrop(cell, true);
      const ring = await flatten(page, [...own, await ringColor(cell)]);
      expect(ratio(ring, await flatten(page, own)), "vs fill").toBeGreaterThanOrEqual(3);
      expect(ratio(ring, await flatten(page, await backdrop(cell, false))), "vs card").toBeGreaterThanOrEqual(3);
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
