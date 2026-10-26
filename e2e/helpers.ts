// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import { existsSync, readFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import path from "node:path";
// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import process from "node:process";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { PERSIST_KEY, PERSIST_VERSION } from "../src/store/persist-meta";

/**
 * The on-screen copy of a message. Outcomes are both rendered (next to a field,
 * or in the status strip) and pushed to a live region, which mounts the same
 * string a frame later; a bare `getByText` then matches twice and trips strict
 * mode. Which of the two the locator sees is a race, so it passes on an idle
 * machine and fails under parallel load. Excluding the visually-hidden region
 * settles it.
 */
export function onScreen(page: Page, text: string | RegExp) {
  return page.getByText(text).and(page.locator(":not(.sr-only)"));
}

/**
 * Seed the persisted store before the app boots. The key and version come from
 * the store, never restated here: a fixture stamped with a version the store no
 * longer accepts is silently discarded, and the failure surfaces as the welcome
 * modal eating the first click.
 */
export function seedStorage(
  page: Page,
  seededState: Record<string, unknown>,
  opts: { clearFirst?: boolean; onlyIfEmpty?: boolean } = {},
) {
  return page.addInitScript(
    ({ key, version, state, clearFirst, onlyIfEmpty }) => {
      if (onlyIfEmpty && window.localStorage.getItem(key)) return;
      if (clearFirst) window.localStorage.clear();
      window.localStorage.setItem(key, JSON.stringify({ state, version }));
    },
    {
      key: PERSIST_KEY,
      version: PERSIST_VERSION,
      state: seededState,
      clearFirst: opts.clearFirst ?? false,
      onlyIfEmpty: opts.onlyIfEmpty ?? false,
    },
  );
}

/**
 * Most flows exercise the workspace, not the first-run welcome. That welcome is
 * now a modal dialog, so leaving it open would intercept every click. Seeding
 * the "returning visitor" flag keeps it closed, and only when nothing is
 * stored yet, so the persistence and migration flows still own their own state.
 * The first-run modal itself is covered by its own tests.
 */
export function asReturningVisitor(page: Page) {
  return seedStorage(page, { authors: [], welcomeSeen: true }, { onlyIfEmpty: true });
}

/**
 * Click a copy button and return what it put on the clipboard.
 *
 * `click()` resolves once the click is dispatched, not once the handler's async
 * work (deflating the payload, then the clipboard write) finishes. An
 * immediate read races that work and can see the old value. Clear first, then
 * wait for the new value: waiting for "a link" would also match the previous
 * copy.
 */
export async function copyFrom(page: Page, button: Locator): Promise<string> {
  const read = () => page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await button.click();
  await expect.poll(read).not.toBe("");
  return read();
}

/**
 * Stub a lookup API the browser calls cross-origin (ORCID, Crossref). The
 * response needs the CORS header the real API sends, or the browser drops it.
 */
export function stubUpstream(page: Page, url: string, status: number, json: unknown) {
  return page.route(url, (route) => route.fulfill({ status, json, headers: { "access-control-allow-origin": "*" } }));
}

// Pin the rule set to WCAG 2.0, 2.1 and 2.2 A + AA so the scan matches what docs/accessibility.md
// documents, rather than tracking axe's shifting defaults (which also include
// best-practice rules).
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
/**
 * Panels scale in and rows fade up, and axe samples computed color; including
 * the opacity of an element still mid-transition. Scanning before motion
 * settles reports contrast failures that never reach the eye, and geometry
 * reads ~4% small. Wait for every running animation, with a ceiling so an
 * intentionally looping one can't hang the suite.
 */
export async function settleMotion(page: Page) {
  await page.evaluate(() => {
    const done = Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const cap = new Promise<void>((r) => setTimeout(r, 2000));
    return Promise.race([done, cap]).then(() => undefined);
  });
}

export const scan = async (page: Page) => {
  await settleMotion(page);
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
};

/** A role's strongest answer on the co-author page: Lead in levels, Contributed in yes/no. */
export function strongestAnswer(page: Page, role: string): Locator {
  return page.getByRole("radiogroup", { name: role, exact: true }).getByRole("radio").last();
}

// Playwright resolves testDir from the repo root, so cwd is the repo root.
const repoRoot = process.cwd();

/** CI builds the package before the tests (playwright.config.ts); locally it may not exist yet. */
export function elementBundleBuilt() {
  return !!process.env.CI || existsSync(path.join(repoRoot, "src/core/dist/element.js"));
}

const elementHostPage = (background: string, color: string) => `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Element host</title>
<script type="importmap">{"imports":{"zod/mini":"/zod/mini/index.js"}}</script>
<style>body{background:${background};color:${color};margin:16px}</style></head>
<body><main><h1>Beiträge</h1><credit-matrix src="/contributions.json" format="by-author"></credit-matrix></main>
<script type="module" src="/dist/element.js"></script></body></html>`;

/**
 * The <credit-matrix> element from the built package, on a bare German page outside the app.
 * Its bundle imports `zod/mini` by bare name, so the page maps that to the installed copy.
 * Every request goes to a made-up origin and is answered here; the app's server is not used.
 */
export async function openElementHost(page: Page, background = "#ffffff", color = "#111111") {
  const contributions = readFileSync(path.join(repoRoot, "e2e/fixtures/element-contributions.json"), "utf8");
  await page.route("http://element.test/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") return route.fulfill({ contentType: "text/html", body: elementHostPage(background, color) });
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
