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
