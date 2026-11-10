// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import process from "node:process";
import { expect, type Page, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

const CITATION_CFF = `cff-version: 1.2.0
message: If you use this software, please cite it.
title: Tide tables
authors:
  - given-names: Ada
    family-names: Lovelace
  - given-names: Grace
    family-names: Hopper
    orcid: https://orcid.org/0000-0002-1825-0097
`;

async function importCitation(page: Page) {
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("#import-text").fill(CITATION_CFF);
  await page.getByRole("button", { name: "Import data" }).click();
  const names = page.getByLabel("Name or ORCID iD", { exact: true });
  // Python starts in the worker: a few seconds on a warm machine, more under parallel load.
  await expect(names).toHaveCount(2, { timeout: 90_000 });
  await expect(names.nth(0)).toHaveValue("Ada Lovelace");
  await expect(names.nth(1)).toHaveValue("Grace Hopper");
}

/**
 * The real path: the citesync worker, the Pyodide runtime the build vendors into
 * /citesync/pyodide/, and the pinned wheels.
 */
test.describe("Citation import", () => {
  test.skip(!process.env.CI, "needs the production build, which vendors the runtime; CI runs one");
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("a pasted CITATION.cff becomes contributors without any other origin", async ({ page, context, baseURL }) => {
    // Every other origin is cut, so a runtime fetched from a CDN fails the import.
    const origin = new URL(baseURL ?? "").origin;
    const outside: string[] = [];
    await context.route(
      (url) => url.origin !== origin,
      (route) => {
        outside.push(route.request().url());
        return route.abort("blockedbyclient");
      },
    );
    await page.goto("/");
    await importCitation(page);
    expect(outside).toEqual([]);
  });

  // No route here: in Firefox, routing sends the worker's requests past the service worker.
  test("after one conversion online, the next works offline", async ({ page, context }) => {
    await page.goto("/");
    // The second load runs through the service worker, so the worker's fetches fill its cache.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await importCitation(page);

    await page
      .getByRole("button", { name: /^Remove / })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Remove / })
      .first()
      .click();
    await context.setOffline(true);
    await importCitation(page);
  });
});
