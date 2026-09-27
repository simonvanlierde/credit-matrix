import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { PERSIST_KEY } from "../src/store/persist-meta";
import { asReturningVisitor } from "./helpers";

/**
 * Automated accessibility scans. axe-core catches a subset of WCAG issues
 * (roughly a third). It is a guardrail against regressions, not a conformance claim.
 * We scan the app's main states; the heatmap SVG is aria-hidden (a text
 * alternative sits beside it) so axe correctly skips it.
 */

// Pin the rule set to WCAG 2.0/2.1 A + AA so the scan matches what the README
// documents, rather than tracking axe's shifting defaults (which also include
// best-practice rules).
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/**
 * Panels scale in and rows fade up, and axe samples computed color; including
 * the opacity of an element still mid-transition. Scanning before motion
 * settles reports contrast failures that never reach the eye, and geometry
 * reads ~4% small. Wait for every running animation, with a ceiling so an
 * intentionally looping one can't hang the suite.
 */
async function settleMotion(page: Page) {
  await page.evaluate(() => {
    const done = Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const cap = new Promise<void>((r) => setTimeout(r, 2000));
    return Promise.race([done, cap]).then(() => undefined);
  });
}

const scan = async (page: Page) => {
  await settleMotion(page);
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
};

/** The contributor rows only; other lists exist (welcome steps, validation). */
function contributorRows(page: Page) {
  return page.locator("section[aria-label=Contributors]").getByRole("listitem");
}

test.describe("Accessibility (axe-core)", () => {
  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("first-run welcome modal has no detectable violations", async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.removeItem(key), PERSIST_KEY);
    await page.goto("/");
    await expect(page.locator("dialog#getting-started")).toBeVisible();
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("returning empty state has no detectable violations", async ({ page }) => {
    await page.goto("/");
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("loaded state (contributors, heatmap, statement) has no detectable violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("mobile loaded state has no detectable violations", async ({ page }) => {
    // The md:hidden mobile branch (per-contributor role buttons on dynamic
    // fills) never renders at the default desktop viewport, so every scan
    // above is blind to it — a hardcoded text color on a pale fill shipped
    // exactly that way once.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("import modal has no detectable violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-text").waitFor({ state: "visible" });
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("validation-error state (contributors with no roles) has no detectable violations", async ({ page }) => {
    await page.goto("/");
    // Imported names have no roles yet, so the validation notice renders.
    await page.getByRole("button", { name: "Import" }).click();
    await page.locator("#import-text").fill("Jane Smith\nBob White");
    await page.getByRole("button", { name: "Import data" }).click();
    await expect(page.getByText(/has no assigned CRediT roles/).first()).toBeVisible();
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("open popover (portalled Radix content) has no detectable violations", async ({ page }) => {
    await page.goto("/");
    // The header "About this app" popover renders its content in a portal.
    await page.getByRole("button", { name: "About this app" }).click();
    const results = await scan(page);
    expect(results.violations).toEqual([]);
    // The Radix Select listbox is deliberately not axe-scanned while open: on
    // open it sets aria-hidden on the rest of the page (to scope focus), which
    // trips axe's aria-hidden-focus rule even though FocusScope traps focus.
    // That is a framework behavior, not an app defect. Keyboard operability of
    // a Radix radiogroup control is covered by the segmented-control test below.
  });

  /**
   * Below `lg` the header nav is hidden and the brand lockup becomes the only
   * route to "How it works" and "About". Every other header assertion in the
   * suite runs at the 1280px default, where the nav still carries them — so
   * without these the whole mobile branch could break, or the nav's `lg`
   * boundary silently revert to `md`, with the suite still green.
   */
  test("below lg the brand menu carries the links the nav drops", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "How it works" })).toBeHidden();

    await page.getByRole("heading", { name: "CRediT Matrix" }).getByRole("button").click();
    await expect(page.getByRole("button", { name: "How it works" })).toBeVisible();
    await expect(page.getByText("Acknowledgements")).toBeVisible();

    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  /**
   * The About panel portals into the <dialog> rather than <body>: showModal()
   * puts the dialog in the top layer and makes the rest of the document inert,
   * so a panel portalled outside it would render and never take a click. Hit
   * testing is the only thing that catches that — the panel looks fine either
   * way.
   */
  test("the About panel inside the welcome modal is operable, and Escape closes only it", async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.removeItem(key), PERSIST_KEY);
    await page.goto("/");
    const dialog = page.locator("dialog#getting-started");
    await dialog.getByRole("button", { name: "About this app" }).click();

    const panel = page.getByText("Acknowledgements");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const topmost = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent ?? null, [
      (box?.x ?? 0) + 2,
      (box?.y ?? 0) + 2,
    ] as [number, number]);
    expect(topmost).toBe("Acknowledgements");

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(dialog).toHaveAttribute("open", "");
  });

  test("dark mode (loaded state) has no detectable violations", async ({ page }) => {
    // defaultTheme="system" + enableSystem, so emulating the color scheme flips
    // <html class="dark"> without needing to click the toggle.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("segmented control is keyboard-operable (radiogroup + arrow keys)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();

    const group = page.getByRole("radiogroup", { name: "Statement grouping" });
    const byAuthor = group.getByRole("radio", { name: "By author" });
    const byRole = group.getByRole("radio", { name: "By role" });

    await expect(byAuthor).toBeChecked();
    await byAuthor.focus();
    await page.keyboard.press("ArrowRight");
    await expect(byRole).toBeChecked();
    await expect(byRole).toBeFocused();
  });

  test("help disclosure exposes state and respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const help = page.getByRole("button", { name: "How it works" });
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await help.click();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#getting-started")).toBeVisible();
  });

  /**
   * axe cannot invoke a keyboard drag, so the dnd-kit sensor needs its own test.
   *
   * This asserts the list is *operable* by keyboard — the sensor is wired up,
   * the activator enters a drag, and an arrow key moves the row. It stops short
   * of asserting the committed order: the drop depends on dnd-kit settling its
   * `over` target, which has no dependable DOM or announcement signal, and
   * asserting it was flaky roughly 3 runs in 5. A flaky test in a required gate
   * is worse than a narrow one. Removing the KeyboardSensor or the drag handle
   * — the realistic regressions — still fails here.
   */
  test("the contributor list is operable by keyboard", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    const rows = contributorRows(page);
    await expect(rows).toHaveCount(3);

    const handle = page.getByRole("button", { name: /Reorder Ada/ });
    await handle.focus();
    await expect(handle).toBeFocused();

    await page.keyboard.press("Space");
    // The activator stays pressed for the whole drag.
    await expect(handle).toHaveAttribute("aria-pressed", "true");

    // Retry the key itself, not just the assertion: under suite load the sensor
    // can miss an arrow press even though the drag has already started, and no
    // DOM state exposes when it is ready. Repeats only move the row further,
    // which still satisfies "an arrow key moves it".
    await expect
      .poll(async () => {
        await page.keyboard.press("ArrowDown");
        return rows.first().evaluate((el) => (el as HTMLElement).style.transform);
      })
      .not.toMatch(/translate3d\(0px, 0px/);

    // Escape cancels the drag; dnd-kit drops the attribute rather than
    // setting it false, so assert on its absence.
    await page.keyboard.press("Escape");
    await expect(handle).not.toHaveAttribute("aria-pressed", "true");
  });

  test("the contributor list exposes its rows as a list", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    // Without list semantics a screen reader gets no item count or position.
    await expect(contributorRows(page)).toHaveCount(3);
  });

  // Removing a row unmounts the button that was just activated. Focus must not
  // fall back to <body>, which sends a keyboard user to the top of the page.
  test("keeps focus in the contributor list after removing a row", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(contributorRows(page)).toHaveCount(3);

    await page
      .getByRole("button", { name: /^Remove / })
      .first()
      .click();
    await expect(contributorRows(page)).toHaveCount(2);

    const focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? "",
      label: document.activeElement?.getAttribute("aria-label") ?? "",
    }));
    expect(focused.tag, "focus fell back to the body").not.toBe("BODY");
    expect(focused.label).toMatch(/^Remove /);
  });

  test("the assigned-cell checkmark stays legible on every grid color", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await page.getByRole("button", { name: "Heatmap options" }).click();
    await page.getByRole("button", { name: "Heatmap color" }).click();
    // The Okabe-Ito yellow is the worst case: a white glyph vanishes on it.
    await page.getByRole("button", { name: "Set color Yellow" }).click();
    await page.keyboard.press("Escape");

    const glyph = page
      .getByRole("button", { name: /Conceptualization for Ada Lovelace: (Contributed|Lead)/ })
      .locator("svg");
    const color = await glyph.evaluate((el) => getComputedStyle(el).color);
    // Dark ink, not white; onColor picks by measured contrast.
    expect(color).toBe("rgb(22, 24, 28)");
  });

  test("each contribution level has its own mark, not just a lighter fill", async ({ page }) => {
    await page.goto("/");
    // The sample's scores are graded, so it opens in Levels.
    await page.getByRole("button", { name: "Load sample data" }).click();

    const dots = (level: string) =>
      page
        .getByRole("table")
        .getByRole("button", { name: new RegExp(`^[^:]+ for [^:]+: ${level}$`) })
        .first()
        .locator("circle")
        .count();
    expect(await dots("Lead")).toBe(3);
    expect(await dots("Equal")).toBe(2);
    expect(await dots("Supporting")).toBe(1);
  });

  test("compact icon controls meet the minimum target size", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();

    const settled = async (target: Locator) => {
      await settleMotion(page);
      return target.boundingBox();
    };

    const reorder = await settled(page.getByRole("button", { name: /Reorder Ada/ }));
    const roleInfo = await settled(page.getByRole("button", { name: "About Conceptualization" }));
    await page.getByRole("button", { name: "Heatmap options" }).click();
    await page.getByRole("button", { name: "Heatmap color" }).click();
    const swatch = await settled(page.getByRole("button", { name: /Set color/ }).first());

    for (const box of [reorder, roleInfo, swatch]) {
      expect(box).not.toBeNull();
      expect(box?.width).toBeGreaterThanOrEqual(24);
      expect(box?.height).toBeGreaterThanOrEqual(24);
    }
  });
});
