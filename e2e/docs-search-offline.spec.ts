// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import process from "node:process";
import { expect, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

test.describe("Offline docs search", () => {
  test.skip(!process.env.CI && !process.env.BASE_URL, "needs a production build and service worker");

  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
  });

  test("the first app visit does not fetch or cache search", async ({ page, context }) => {
    const searchRequests: string[] = [];
    context.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/pagefind/")) searchRequests.push(request.url());
    });
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForLoadState("networkidle");
    expect(searchRequests).toEqual([]);
    expect(
      await page.evaluate(async () => {
        const cachesByName = await Promise.all((await caches.keys()).map((name) => caches.open(name)));
        const entries = (await Promise.all(cachesByName.map((cache) => cache.keys()))).flat();
        return entries.filter((entry) => new URL(entry.url).pathname.startsWith("/pagefind/")).length;
      }),
    ).toBe(0);
  });

  for (const docPath of ["/docs", "/docs/quarto"]) {
    test(`a first search works offline after visiting ${docPath} and obeys the same-origin CSP`, async ({
      page,
      context,
      request,
    }) => {
      const errors: string[] = [];
      const metadataRequests: string[] = [];
      context.on("request", (entry) => {
        if (new URL(entry.url()).pathname === "/pagefind/pagefind-entry.json") metadataRequests.push(entry.url());
      });
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          document.documentElement.dataset.cspViolation = `${event.violatedDirective} ${event.blockedURI}`;
        });
      });
      if (docPath === "/docs/quarto") {
        await page.addInitScript(() => {
          const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
          navigator.serviceWorker.register = (...args) =>
            new Promise<ServiceWorkerRegistration>((resolve, reject) => {
              document.addEventListener("start-docs-worker", () => void register(...args).then(resolve, reject), {
                once: true,
              });
            });
        });
      }
      const response = await page.goto(docPath);
      expect(response?.headers()["content-security-policy"]).toContain("worker-src 'self'");
      const build = await page.locator('meta[name="docs-search-build"]').getAttribute("content");
      expect(build).toBeTruthy();
      if (docPath === "/docs/quarto") {
        await expect(page.getByText("Showing sample data", { exact: true })).toBeVisible();
        await page.evaluate(() => document.dispatchEvent(new Event("start-docs-worker")));
      }
      await page.evaluate(() => navigator.serviceWorker.ready);
      const sw = await (await request.get("/sw.js")).text();
      const searchAssets: string[] = JSON.parse(sw.match(/const SEARCH_ASSETS = (\[.*?\]);/)?.[1] ?? "[]");
      const docsAssetsByPath: Record<string, string[]> = JSON.parse(
        sw.match(/const DOCS_ASSETS = (\{.*?\});/)?.[1] ?? "{}",
      );
      const docsAssets = docsAssetsByPath[docPath] ?? [];
      expect(docsAssets).toHaveLength(docPath === "/docs/quarto" ? 2 : 1);
      expect(searchAssets).toContain(`/pagefind/pagefind-entry.json?ts=${build}`);
      expect(searchAssets.some((path) => path.endsWith("wasm.en.pagefind"))).toBe(true);
      await expect
        .poll(() =>
          page.evaluate(
            async (paths) => {
              const matches = await Promise.all(paths.map((path) => caches.match(path)));
              return matches.every(Boolean);
            },
            [...searchAssets, ...docsAssets, docPath],
          ),
        )
        .toBe(true);
      if (docPath === "/docs/quarto") {
        const liveChunk = await page.evaluate(
          () =>
            performance.getEntriesByType("resource").find((entry) => /\/LiveExample-[\w-]+\.js$/.test(entry.name))
              ?.name,
        );
        expect(liveChunk).toBeTruthy();
        await expect
          .poll(() => page.evaluate(async (url) => Boolean(await caches.match(url as string)), liveChunk))
          .toBe(true);
      }

      // No query has run: every index chunk and result fragment must already be cached.
      await context.setOffline(true);
      await page.reload();
      if (docPath === "/docs/quarto")
        await expect(page.getByText("Showing sample data", { exact: true })).toBeVisible();
      const search = page.getByRole("region", { name: "Search documentation" });
      await search.getByRole("combobox").fill("quarto");
      await expect(search.getByRole("option").and(page.locator('a[href^="/docs/quarto"]')).first()).toBeVisible();
      expect(metadataRequests.length).toBeGreaterThan(0);
      expect(metadataRequests.every((url) => new URL(url).searchParams.get("ts") === build)).toBe(true);
      expect(await page.locator("html").getAttribute("data-csp-violation")).toBeNull();
      expect(errors).toEqual([]);
    });
  }
});
