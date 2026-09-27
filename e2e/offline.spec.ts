// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import process from "node:process";
import { expect, test } from "@playwright/test";

/**
 * The offline path needs the shipped bundle: `ServiceWorkerRegistrar` skips
 * registration in development, where a cache in front of unhashed dev modules
 * would fight HMR. CI runs the suite against `pnpm build && pnpm start`, so
 * that is where this test runs; locally `pnpm dev` serves the app and it skips.
 */
test.describe("Offline", () => {
  test("the workspace still loads with the network cut", async ({ page, context }) => {
    test.skip(!process.env.CI, "needs the production build; CI runs one");
    await page.goto("/");
    // Registration happens in an effect, and only the second load runs through
    // the worker, which is the load that fills the cache.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole("heading", { name: "CRediT Matrix" })).toBeVisible();

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole("heading", { name: "CRediT Matrix" })).toBeVisible();
    await page.getByRole("button", { name: "Load sample data" }).click();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  });

  test("the manifest is served and installable", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as { icons: { src: string }[]; start_url: string };
    expect(manifest.start_url).toBe("/");
    for (const icon of manifest.icons) {
      expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
    }
  });

  test("a POST to /api/doi is never served from the cache offline", async ({ page, context }) => {
    test.skip(!process.env.CI, "needs the production build; CI runs one");
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);

    await context.setOffline(true);
    // sw.js's fetch handler bails out for anything but GET, so a POST is never
    // written to or answered from the cache: offline, it must fail like any
    // other network request rather than come back with a cached 200.
    const outcome = await page.evaluate(async () => {
      try {
        await fetch("/api/doi", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ doi: "10.1234/abcde" }),
        });
        return "responded";
      } catch {
        return "network-error";
      }
    });
    expect(outcome).toBe("network-error");
  });

  test("activating a new service worker drops caches from a previous version", async ({ page }) => {
    test.skip(!process.env.CI, "needs the production build; CI runs one");
    // Leave a cache from an older version before any worker exists. /health
    // is same-origin but plain JSON, so nothing registers the worker there.
    // Re-registering from a controlled page would not do: an identical script
    // revives the old registration and `activate` never runs again.
    await page.goto("/health");
    await page.evaluate(() => caches.open("credit-matrix-v0-stale"));

    // The first visit installs and activates the worker, and `activate` runs
    // dropOldCaches().
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("credit-matrix-v0-stale");
  });
});
