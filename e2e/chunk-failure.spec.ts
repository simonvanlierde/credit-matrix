import { expect, test } from "@playwright/test";

test("a route chunk that fails to load reloads once, then says so instead of leaving the page inert", async ({
  page,
}) => {
  await page.route(/\/assets\/page-[^/]+\.js$/, (route) => route.abort());
  let documents = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents += 1;
  });
  await page.goto("/about");
  await expect(page.getByText("This page could not load.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Reload the page" })).toBeVisible();
  // The first failure reloads; the second falls back, so the page cannot loop.
  expect(documents).toBe(2);
});
