// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import { existsSync, readFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import process from "node:process";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { PERSIST_KEY } from "../src/store/persist-meta";
import { asReturningVisitor, scan, settleMotion } from "./helpers";

/**
 * Automated accessibility scans. axe-core catches a subset of WCAG issues
 * (roughly a third). It is a guardrail against regressions, not a conformance claim.
 * We scan the app's main states; the heatmap SVG is aria-hidden (a text
 * alternative sits beside it) so axe correctly skips it.
 */

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

  // WCAG 2.5.7: author order is credit, so it must not depend on dragging.
  test("reorders a contributor without dragging", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    const rows = contributorRows(page);
    await expect(rows).toHaveCount(3);

    await page.getByRole("button", { name: "Actions for Ada Lovelace" }).click();
    await expect(page.getByRole("button", { name: "Move up" })).toBeDisabled();
    await page.getByRole("button", { name: "Move down" }).click();
    await expect(rows.nth(1).getByLabel("Name or ORCID iD", { exact: true })).toHaveValue("Ada Lovelace");
  });

  test("inspector tabs follow the tabs pattern", async ({ page }) => {
    await page.goto("/");
    const statement = page.getByRole("tab", { name: "Statement" });
    await statement.focus();
    await page.keyboard.press("ArrowRight");
    const team = page.getByRole("tab", { name: "Team" });
    await expect(team).toBeFocused();
    await expect(team).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Team" })).toBeVisible();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Published practice" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Review" })).toBeFocused();
    await expect(page.getByText("Answers from co-authors appear here")).toBeVisible();
  });

  test("the published practice tab is a labelled table with no detectable violations, light and dark", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    await page.getByRole("tab", { name: "Published practice" }).click();
    const panel = page.getByRole("tabpanel", { name: "Published practice" });
    await panel.getByRole("combobox", { name: "Your field" }).click();
    await page.getByRole("option", { name: "Medicine" }).click();
    const table = panel.getByRole("table", { name: "Share of authors given each role, by author position" });
    await expect(table.getByRole("row")).toHaveCount(15);
    await expect(table.getByRole("rowheader", { name: "Conceptualization" })).toBeVisible();
    await expect(panel.getByText(/not checked by hand/)).toBeVisible();
    // Nobody in the sample is marked as you, so no column is marked and the panel says how to.
    await expect(panel.getByText(/choose “This is me”/)).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    expect((await scan(page)).violations).toEqual([]);
    // The choice is a preference: it survives a reload.
    await page.reload();
    await page.getByRole("tab", { name: "Published practice" }).click();
    await expect(page.getByRole("combobox", { name: "Your field" })).toHaveText(/Medicine/);
  });

  test("a keyboard reaches the published practice panel and scrolls it to the last row", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    const tab = page.getByRole("tab", { name: "Published practice" });
    await tab.click();
    const panel = page.getByRole("tabpanel", { name: "Published practice" });
    await panel.getByRole("combobox", { name: "Your field" }).click();
    await page.getByRole("option", { name: "Medicine" }).click();
    const lastRow = panel.getByRole("rowheader", { name: "Writing – review & editing" });
    await expect(lastRow).not.toBeInViewport();
    // The panel scrolls on its own and the table has no control in it, so the panel is the stop.
    await tab.focus();
    await page.keyboard.press("Tab");
    await expect(panel).toBeFocused();
    await page.keyboard.press("End");
    await expect(lastRow).toBeInViewport();
  });

  // The role names left the tab order with the info buttons; arrow keys reach them.
  test("arrow keys reach a role name, which opens its description", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Load sample data" }).click();
    const cell = page.getByRole("button", { name: /^Conceptualization for Ada Lovelace:/ });
    await expect(cell).toHaveAttribute("aria-keyshortcuts", "0 1 2 3 Shift+F10");
    await cell.focus();
    await page.keyboard.press("ArrowLeft");
    const role = page.getByRole("button", { name: "Conceptualization", exact: true });
    await expect(role).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: /Full definition/ })).toBeVisible();
    await page.keyboard.press("Escape");
    // Focus comes back once the panel's exit animation ends.
    await expect(role).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(cell).toBeFocused();
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
    const roleInfo = await settled(page.getByRole("button", { name: "Conceptualization", exact: true }));
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

/**
 * The <credit-matrix> element from the built package, on a bare page outside the app. Its
 * bundle imports `zod/mini` by bare name, so the page maps that to the installed copy. Every
 * request goes to a made-up origin and is answered here; the app's server is not used.
 */
test.describe("<credit-matrix> element (axe-core)", () => {
  // Playwright resolves testDir from the repo root, so cwd is the repo root.
  const repoRoot = process.cwd();
  const bundle = path.join(repoRoot, "src/core/dist/element.js");
  const contributions = readFileSync(path.join(repoRoot, "e2e/fixtures/element-contributions.json"), "utf8");

  const hostPage = (background: string, color: string) => `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Element host</title>
<script type="importmap">{"imports":{"zod/mini":"/zod/mini/index.js"}}</script>
<style>body{background:${background};color:${color};margin:16px}</style></head>
<body><main><h1>Beiträge</h1><credit-matrix src="/contributions.json" format="by-author"></credit-matrix></main>
<script type="module" src="/dist/element.js"></script></body></html>`;

  async function openHost(page: Page, background: string, color: string) {
    await page.route("http://element.test/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/") return route.fulfill({ contentType: "text/html", body: hostPage(background, color) });
      if (pathname === "/contributions.json")
        return route.fulfill({ contentType: "application/json", body: contributions });
      if (pathname.startsWith("/dist/"))
        return route.fulfill({ path: path.join(repoRoot, "src/core", pathname), contentType: "text/javascript" });
      if (pathname.startsWith("/zod/"))
        return route.fulfill({ path: path.join(repoRoot, "node_modules", pathname), contentType: "text/javascript" });
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto("http://element.test/");
    await expect(page.locator("credit-matrix figure p").first()).toBeVisible();
  }

  test.beforeEach(() => {
    // CI builds the package before the tests (playwright.config.ts); locally it may not exist yet.
    test.skip(!(process.env.CI || existsSync(bundle)), "Build the package first: pnpm --filter credit-matrix build");
  });

  for (const [name, background, color] of [
    ["light", "#ffffff", "#111111"],
    ["dark", "#111111", "#eeeeee"],
  ] as const) {
    test(`element on a ${name} page has no detectable violations`, async ({ page }) => {
      await openHost(page, background, color);
      expect((await scan(page)).violations).toEqual([]);
      // The page is German, so the figure is too, and the table gives each level in words.
      await expect(page.locator("credit-matrix figure")).toHaveAttribute("lang", "de");
      await expect(page.locator("credit-matrix tbody td").first()).toHaveText(
        /Führend|Gleichwertig|Unterstützend|Keine/,
      );
    });
  }

  test("element on a 320px screen scrolls the heatmap instead of shrinking it", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openHost(page, "#ffffff", "#111111");
    expect((await scan(page)).violations).toEqual([]);
    const svg = page.locator("credit-matrix svg");
    // Drawn at its own width (plus its 1px border on each side), wider than the 256px card.
    const drawn = await svg.evaluate((el) => el.getBoundingClientRect().width);
    expect(drawn).toBeCloseTo(Number(await svg.getAttribute("width")) + 2, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
