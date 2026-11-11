// biome-ignore lint/correctness/noNodejsModules: inspects exported figure bytes.
import { readFile } from "node:fs/promises";
// biome-ignore lint/correctness/noNodejsModules: matches the existing production-only offline tests.
import process from "node:process";
import { expect, test } from "@playwright/test";
import { asReturningVisitor, onScreen } from "./helpers";

test("downloads embedded-font SVG, PDF and PNG from the same draft", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  for (const format of ["SVG", "PDF", "PNG"]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Download ${format}`, exact: true }).click();
    const downloaded = await pending;
    expect(downloaded.suggestedFilename()).toBe(`credit-heatmap.${format.toLowerCase()}`);
    const path = await downloaded.path();
    if (!path) throw new Error("Figure download has no local file");
    const bytes = await readFile(path);
    if (format === "SVG") {
      expect(bytes.toString()).toContain("@font-face");
      expect(bytes.toString()).toContain("<tspan font-family=");
    } else if (format === "PDF") {
      expect(bytes.subarray(0, 8).toString()).toBe("%PDF-1.7");
    } else {
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    }
  }
});

test("exports SVG and PNG in system fonts when the figure fonts lack a glyph, but not PDF", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  const names = page.getByLabel("New author names or ORCID iD");
  await names.fill("김민준");
  await names.press("Enter");
  await page.getByRole("button", { name: /^Software for 김민준:/ }).click();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await expect(onScreen(page, /The figure fonts cannot display these characters: 김민준/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeDisabled();
  for (const format of ["SVG", "PNG"]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Download ${format}`, exact: true }).click();
    const path = await (await pending).path();
    if (!path) throw new Error("Figure download has no local file");
    const bytes = await readFile(path);
    if (format === "SVG") expect(bytes.toString()).toMatch(/<tspan font-family="'IBM Plex Sans'[^"]*">김민준<\/tspan>/);
    else expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  }
});

test("fetches only the figure font faces a Latin figure needs", async ({ page }) => {
  const fonts = new Set<string>();
  page.on("request", (request) => {
    const file = new URL(request.url()).pathname.match(/\/(NotoS[a-z]+-Regular|CreditFigure[A-Za-z]+)[^/]*\.ttf$/)?.[1];
    if (file) fonts.add(file);
  });
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  for (const format of ["SVG", "PDF"]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Download ${format}`, exact: true }).click();
    await pending;
  }
  expect([...fonts]).toEqual(["NotoSans-Regular"]);
});

test("exports a PDF offline once an export has fetched its fonts", async ({ page, context }) => {
  test.skip(test.info().project.name !== "chromium", "One service-worker check covers the shared offline cache");
  test.skip(!process.env.CI, "Requires the production build");
  await asReturningVisitor(page);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  const online = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  await online;
  await context.setOffline(true);
  // The draft persists, so the reloaded page opens on the same figure.
  await page.reload();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  const offline = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await offline).suggestedFilename()).toBe("credit-heatmap.pdf");
});

test("exports a Latin figure offline without an earlier export", async ({ page, context }) => {
  test.skip(test.info().project.name !== "chromium", "One service-worker check covers the shared offline cache");
  test.skip(!process.env.CI, "Requires the production build");
  await asReturningVisitor(page);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole("button", { name: "Load sample data" }).click();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  for (const format of ["SVG", "PDF"]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Download ${format}`, exact: true }).click();
    expect((await pending).suggestedFilename()).toBe(`credit-heatmap.${format.toLowerCase()}`);
  }
});
